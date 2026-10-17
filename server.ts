import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';
import net from 'net';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
const hasGeminiApiKey =
  Boolean(geminiApiKey) &&
  !['your-gemini-api-key', 'MY_GEMINI_API_KEY', 'YOUR_GEMINI_API_KEY'].includes(
    geminiApiKey!
  );

// Increase body parser limit to support PDF uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Initialize server-side Google GenAI client
const ai = hasGeminiApiKey
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

const MAX_REMOTE_PDF_BYTES = 25 * 1024 * 1024;
const MAX_REMOTE_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [first, second] = address.split('.').map(Number);
    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first === 0
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }

  return true;
}

async function validateRemoteUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Please provide a valid website or PDF URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http:// and https:// URLs are supported.');
  }

  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not supported.');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    (net.isIP(hostname) > 0 && isPrivateAddress(hostname))
  ) {
    throw new Error('Local and private-network URLs are not supported.');
  }

  const addresses = net.isIP(hostname)
    ? [hostname]
    : (await dns.lookup(hostname, { all: true })).map(({ address }) => address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error('The URL resolves to a local or private network address.');
  }

  return url;
}

async function readResponseBytes(response: globalThis.Response, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('The remote document is too large to process.');
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) {
    throw new Error('The remote document is too large to process.');
  }
  return bytes;
}

function getPdfLinks(html: string, sourceUrl: URL): string[] {
  const links: string[] = [];
  const hrefPattern = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefPattern.exec(html)) !== null) {
    try {
      const link = new URL(match[1], sourceUrl);
      if (
        ['http:', 'https:'].includes(link.protocol) &&
        /\.pdf(?:$|[?#])/i.test(link.pathname + link.search)
      ) {
        links.push(link.toString());
      }
    } catch {
      // Ignore malformed links and continue scanning the page.
    }
  }

  return [...new Set(links)];
}

  function decodeHtmlEntities(value: string): string {
    return value
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
  }

  function extractWebsiteText(html: string): { title: string; text: string; links: string[] } {
    const title = decodeHtmlEntities(
      (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ')
    ).replace(/\s+/g, ' ').trim();
    const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => `${decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()} -> ${match[1]}`)
      .filter((link) => !link.startsWith(' ->'));
    const text = decodeHtmlEntities(
      html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
      .replace(/\s+/g, ' ')
      .trim();

    return {
      title: title || 'Website syllabus',
      text: `${title ? `Page title: ${title}\n\n` : ''}${text}${links.length ? `\n\nLinks:\n${links.join('\n')}` : ''}`.slice(
        0,
        MAX_REMOTE_PAGE_BYTES
      ),
      links,
    };
  }

  async function scrapeWebsite(
    inputUrl: string,
    redirectCount = 0
  ): Promise<{ title: string; text: string; sourceUrl: string }> {
    if (redirectCount > MAX_REDIRECTS) {
      throw new Error('The website redirected too many times.');
    }
    const url = await validateRemoteUrl(inputUrl);
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('The website returned an invalid redirect.');
      return scrapeWebsite(new URL(location, url).toString(), redirectCount + 1);
    }
    if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
      throw new Error('This URL is not an HTML webpage. Use the PDF option for PDF files.');
    }

    const html = (await readResponseBytes(response, MAX_REMOTE_PAGE_BYTES)).toString('utf8');
    const extracted = extractWebsiteText(html);
    if (extracted.text.length < 40) throw new Error('The webpage did not contain enough readable text to analyze.');
    return { title: extracted.title, text: extracted.text, sourceUrl: url.toString() };
  }

async function fetchRemotePdf(inputUrl: string): Promise<{ base64: string; filename: string }> {
  let currentUrl = await validateRemoteUrl(inputUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(currentUrl, {
      redirect: 'manual',
      headers: { Accept: 'application/pdf,text/html;q=0.9,*/*;q=0.1' },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw new Error('The remote URL redirected too many times or provided an invalid redirect.');
      }
      currentUrl = await validateRemoteUrl(new URL(location, currentUrl).toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`The remote URL returned HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    if (contentType.includes('application/pdf') || currentUrl.pathname.toLowerCase().endsWith('.pdf')) {
      const bytes = await readResponseBytes(response, MAX_REMOTE_PDF_BYTES);
      if (bytes.subarray(0, 5).toString() !== '%PDF-') {
        throw new Error('The remote file is not a valid PDF.');
      }
      return {
        base64: bytes.toString('base64'),
        filename: decodeURIComponent(path.basename(currentUrl.pathname)) || 'remote-document.pdf',
      };
    }

    if (contentType.includes('text/html')) {
      const html = (await readResponseBytes(response, MAX_REMOTE_PAGE_BYTES)).toString('utf8');
      const pdfLinks = getPdfLinks(html, currentUrl);
      if (pdfLinks.length === 0) {
        throw new Error('No PDF link was found on the supplied webpage.');
      }
      currentUrl = await validateRemoteUrl(pdfLinks[0]);
      continue;
    }

    throw new Error('The remote URL is not a PDF or an HTML page containing a PDF link.');
  }

  throw new Error('Unable to fetch the remote PDF.');
}

app.post('/api/fetch-pdf', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({
        error: 'Missing URL',
        message: 'Please provide a website or PDF URL.',
      });
    }

    const pdf = await fetchRemotePdf(url.trim());
    return res.json({ success: true, ...pdf });
  } catch (error: any) {
    console.error('Error in /api/fetch-pdf:', error);
    return res.status(400).json({
      error: 'Unable to fetch PDF',
      message: error?.message || 'The remote PDF could not be fetched.',
    });
  }
});

app.post('/api/scrape-website', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'Missing URL', message: 'Please provide a webpage URL.' });
    }
    return res.json({ success: true, ...(await scrapeWebsite(url.trim())) });
  } catch (error: any) {
    console.error('Error in /api/scrape-website:', error);
    return res.status(400).json({
      error: 'Unable to scrape website',
      message: error?.message || 'The webpage could not be scraped.',
    });
  }
});

// Endpoint: Analyze PDF document with Gemini API
app.post('/api/analyze-pdf', async (req: Request, res: Response) => {
  try {
    const { pdfBase64, documentText, filename, sourceUrl } = req.body;

    if (!pdfBase64 && !documentText) {
      return res.status(400).json({
        error: 'Missing document',
        message: 'Please provide a PDF or scraped website text to analyze.',
      });
    }

    if (!hasGeminiApiKey || !ai) {
      return res.status(500).json({
        error: 'Missing GEMINI_API_KEY',
        message:
          'GEMINI_API_KEY is missing or still uses a placeholder. Add a valid Gemini API key to the project .env file and restart the server.',
      });
    }

    const cleanBase64 = pdfBase64
      ? pdfBase64.replace(/^data:application\/pdf;base64,/, '').replace(/\s/g, '')
      : '';

    const promptText = `You are an academic document extraction specialist.
Analyze the attached PDF syllabus, course document, calendar, schedule, or exam guide (${filename || 'document.pdf'}).
Extract every dated academic event, including assignments, homework, exams, midterms, finals, quizzes, projects, labs, presentations, papers, lectures, meetings, breaks, and other important class events.
Also extract a concise, student-friendly key information section for the course.
Use only facts supported by the document. Never invent dates, times, locations, grading weights, policies, instructors, or materials.
If a date or time is ambiguous, preserve the uncertainty in sourceQuote and set confidence to "low". If a time is missing, leave it absent rather than guessing.

For each item, extract:
1. id: A unique alphanumeric identifier (e.g., "item-1", "midterm-1", "proj-2")
2. title: The exact title or name of the assignment/exam (e.g., "Midterm Exam 1", "Project 3: Neural Net Classifier")
3. type: Classification, one of: "assignment", "exam", "quiz", "project", "midterm", "final", "lab", "homework", "presentation", "paper"
4. dueDate: Event date in ISO format YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss. Do not add a time when the document does not provide one.
5. weight: Weight towards final grade, e.g., "15%", "25%", "100 pts", "10%"
6. description: Brief summary of instructions, coverage, and requirements
7. location: Room, building, online platform, or other location when stated
8. sourceQuote: Short verbatim evidence from the document supporting the event
9. sourcePage: The 1-based PDF page containing the evidence when available; omit for website text or when unknown
10. confidence: "high", "medium", or "low" based on how clearly the document states the event
11. prepingInfo:
   - id: Unique identifier for preparation (e.g., "prep-item-1")
   - duration: Recommended prep duration (e.g., "12 hours across 4 days", "6 hours", "3 days")
   - summary: Specific, actionable study advice and preparation checklist (chapters, practice problems, draft reviews, software setup)
   - prepDate: Recommended preparation start date in YYYY-MM-DD format (scheduled ahead of the due date, e.g., 5 to 10 days before exams/projects, 2 to 4 days for homework)
   - milestones: 2 to 4 actionable study blocks/milestones leading up to the due date with dayOffset (days prior to dueDate), title, and durationMinutes.

Also detect the courseName, courseCode, instructor, and semester from the syllabus header.
For keyInfo, extract overview, meetingSchedule, location, gradingPolicy, requiredMaterials, policies, officeHours, and importantNotes.
Return valid JSON only. Ensure every date is valid ISO format and never append explanatory text to a date.`;

    const sourceContext = sourceUrl ? `Source webpage: ${sourceUrl}\n\n` : '';
    const contents = documentText
      ? [{ text: `${sourceContext}${documentText}\n\n${promptText}` }]
      : [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: cleanBase64,
            },
          },
          { text: promptText },
        ];

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            courseName: { type: Type.STRING, description: 'Full course title' },
            courseCode: { type: Type.STRING, description: 'Course code like CS 189 or MATH 110' },
            instructor: { type: Type.STRING, description: 'Course instructor name' },
            semester: { type: Type.STRING, description: 'Semester or term, e.g. Fall 2026 or Spring 2026' },
            keyInfo: {
              type: Type.OBJECT,
              description: 'Important course information extracted from the document',
              properties: {
                overview: { type: Type.STRING },
                meetingSchedule: { type: Type.STRING },
                location: { type: Type.STRING },
                gradingPolicy: { type: Type.STRING },
                requiredMaterials: { type: Type.ARRAY, items: { type: Type.STRING } },
                policies: { type: Type.ARRAY, items: { type: Type.STRING } },
                officeHours: { type: Type.STRING },
                importantNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
            },
            items: {
              type: Type.ARRAY,
              description: 'List of all assignments, projects, quizzes, and exams',
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: 'Unique identifier' },
                  title: { type: Type.STRING, description: 'Assignment or exam title' },
                  type: { type: Type.STRING, description: 'Type of item' },
                  dueDate: { type: Type.STRING, description: 'Due date in YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss format' },
                  weight: { type: Type.STRING, description: 'Percentage or point weight' },
                  description: { type: Type.STRING, description: 'Summary of the assignment or exam' },
                  location: { type: Type.STRING, description: 'Room, building, platform, or location' },
                  sourceQuote: { type: Type.STRING, description: 'Short source evidence quote' },
                  sourcePage: { type: Type.INTEGER, description: '1-based source PDF page when available' },
                  confidence: { type: Type.STRING, description: 'high, medium, or low' },
                  prepingInfo: {
                    type: Type.OBJECT,
                    description: 'Preparation time, schedule, and checklist',
                    properties: {
                      id: { type: Type.STRING, description: 'Prep session ID' },
                      duration: { type: Type.STRING, description: 'Recommended prep time duration' },
                      summary: { type: Type.STRING, description: 'Detailed study summary and guidelines' },
                      prepDate: { type: Type.STRING, description: 'Recommended prep start date (YYYY-MM-DD)' },
                      milestones: {
                        type: Type.ARRAY,
                        description: 'Step-by-step prep milestones leading up to deadline',
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            id: { type: Type.STRING },
                            dayOffset: { type: Type.INTEGER, description: 'Days before dueDate' },
                            title: { type: Type.STRING, description: 'Specific milestone task' },
                            durationMinutes: { type: Type.INTEGER, description: 'Time in minutes for this session' },
                          },
                          required: ['id', 'title'],
                        },
                      },
                    },
                    required: ['id', 'duration', 'summary'],
                  },
                },
                required: ['id', 'title', 'type', 'dueDate', 'weight', 'prepingInfo'],
              },
            },
          },
          required: ['items'],
        },
      },
    });

    const outputText = response.text;
    if (!outputText) {
      throw new Error('Gemini API returned an empty response.');
    }

    const parsedData = JSON.parse(outputText);
    return res.json({
      success: true,
      data: parsedData,
      rawTokens: response.usageMetadata,
    });
  } catch (error: any) {
    console.error('Error in /api/analyze-pdf:', error);
    return res.status(500).json({
      error: 'Analysis Failed',
      message: error?.message || 'Failed to analyze PDF with Gemini API.',
    });
  }
});

// Setup Vite middleware in dev or static files in production
async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
