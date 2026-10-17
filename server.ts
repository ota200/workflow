import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dns from 'dns/promises';
import net from 'net';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { extractText, getDocumentProxy } from 'unpdf';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemma-4-31b-it';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash';
const GEMINI_MAX_OUTPUT_TOKENS = parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '8192', 10);
const isGemmaModel = /^gemma-/i.test(GEMINI_MODEL);
const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const hasGeminiApiKey =
  Boolean(geminiApiKey) &&
  !['your-gemini-api-key', 'MY_GEMINI_API_KEY', 'YOUR_GEMINI_API_KEY'].includes(
    geminiApiKey!
  );

// Increase body parser limit to support PDF uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && (corsOrigins.includes('*') || corsOrigins.includes(requestOrigin))) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

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
const MAX_MODEL_TEXT_CHARS = parseInt(process.env.MAX_MODEL_TEXT_CHARS || '240000', 10);
const MODEL_RETRY_DELAYS_MS = [750];
const analysisCache = new Map<string, Record<string, unknown>>();
const prepCache = new Map<string, Record<string, unknown>>();

function documentCacheKey(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function extractPdfText(pdfBytes: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];

  return pages
    .map((page, index) => `--- PDF page ${index + 1} ---\n${page}`)
    .join('\n\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function limitModelText(text: string): string {
  if (text.length <= MAX_MODEL_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_MODEL_TEXT_CHARS)}\n\n[Document text truncated before model analysis.]`;
}

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

function parseModelJson(outputText: string): unknown {
  const fencedJson = outputText.match(/```(?:json)?\s*([\s\S]*?)\s*```/)?.[1];
  const candidate = (fencedJson || outputText)
    .replace(/^\uFEFF/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const positions = [candidate.indexOf('{'), candidate.indexOf('[')].filter((index) => index >= 0);
    const start = positions.length ? Math.min(...positions) : -1;
    if (start < 0) throw new Error('The model did not return JSON.');

    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (end < start) throw new Error('The model returned incomplete JSON.');
    const extracted = candidate
      .slice(start, end + 1)
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
    return JSON.parse(extracted);
  }
}

async function repairModelJson(outputText: string, context: string): Promise<unknown> {
  const repairPrompt = `Repair the following model output into valid JSON.
Return JSON only, with no Markdown or explanation. Preserve every value and key; only fix JSON syntax.
It must satisfy this shape: ${context}

MODEL OUTPUT:
${outputText}`;
  const response = await generateAnalysis([{ text: repairPrompt }], {
    maxOutputTokens: Math.min(GEMINI_MAX_OUTPUT_TOKENS, 4096),
    responseMimeType: 'application/json',
  });
  if (!response.text) throw new Error('The model returned an empty JSON repair response.');
  return parseModelJson(response.text);
}

function normalizeAnalysisResult(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { items: value };
  if (!value || typeof value !== 'object') {
    throw new Error('The model returned an unsupported response shape.');
  }

  const object = value as Record<string, unknown>;
  if (Array.isArray(object.items)) return object;

  for (const key of ['events', 'assignments', 'schedule', 'classes', 'results']) {
    if (Array.isArray(object[key])) return { ...object, items: object[key] };
  }

  if (object.data && typeof object.data === 'object') return normalizeAnalysisResult(object.data);
  throw new Error('The model response did not contain an items array.');
}

function isTemporaryModelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:429|500|502|503|504)\b|(?:UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand)/i.test(message);
}

async function withModelRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = MODEL_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !isTemporaryModelError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

type GenerateContentRequest = Parameters<NonNullable<typeof ai>['models']['generateContent']>[0];

async function generateAnalysis(
  contents: GenerateContentRequest['contents'],
  config: GenerateContentRequest['config'],
) {
  try {
    return await withModelRetry(() => ai!.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config,
    }));
  } catch (error) {
    if (!isTemporaryModelError(error) || GEMINI_FALLBACK_MODEL === GEMINI_MODEL) throw error;
    console.warn(`Model "${GEMINI_MODEL}" is temporarily unavailable; using "${GEMINI_FALLBACK_MODEL}" for this request.`);
    return withModelRetry(() => ai!.models.generateContent({
      model: GEMINI_FALLBACK_MODEL,
      contents,
      config: {
        ...config,
        responseMimeType: 'application/json',
      },
    }));
  }
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

app.get('/api/model-status', async (_req: Request, res: Response) => {
  if (!hasGeminiApiKey || !geminiApiKey) {
    return res.status(500).json({ error: 'Missing GEMINI_API_KEY', models: [] });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiApiKey)}`
    );
    const payload = (await response.json()) as {
      models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
      error?: { message?: string };
    };
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload.error?.message || 'Google AI could not list models for this API key.',
        models: [],
      });
    }
    const models = (payload.models || [])
      .filter((model) => model.name)
      .map((model) => ({
        name: model.name!.replace(/^models\//, ''),
        displayName: model.displayName || model.name,
        canGenerateContent: model.supportedGenerationMethods?.includes('generateContent') || false,
      }));
    return res.json({
      configured: { primary: GEMINI_MODEL, fallback: GEMINI_FALLBACK_MODEL },
      models,
      primary: models.find((model) => model.name === GEMINI_MODEL) || null,
      fallback: models.find((model) => model.name === GEMINI_FALLBACK_MODEL) || null,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unable to verify Google AI models.',
      models: [],
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
    const cacheKey = documentCacheKey(cleanBase64 || documentText?.trim() || '');
    const cached = analysisCache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached, cached: true });

    const promptText = `You are a high-precision academic document parser for a student scheduling app.
Analyze the entire document "${filename || 'document.pdf'}", including tables, headers, footnotes, appendices, and text near dates.
This is the fast event-discovery pass. Do not generate study plans, revision advice, preparation summaries, or milestones.

OBJECTIVE
Extract every distinct, supported academic event and concise course information. The document may be a syllabus,
course outline, academic calendar, exam schedule, assignment sheet, LMS export, timetable, announcement, or mixed document.
Find events even when dates are in tables, column headings, bullets, paragraphs, abbreviated labels, or weekly schedules.

EVENTS TO INCLUDE
Assignments, homework, problem sets, submissions, quizzes, tests, midterms, finals, exams, projects, checkpoints,
demonstrations, labs, lab reports, presentations, papers, readings with an explicit date, lectures, meetings, reviews,
holidays, breaks, cancellations, registration deadlines, and other relevant academic dates.
Do not discard a date-only schedule entry when its academic context is clear. Do not turn arbitrary metadata or example
dates into events. Do not merge distinct events sharing a date or duplicate the same event repeated in the document.

DATE RULES
- Use dueDate as YYYY-MM-DD or YYYY-MM-DDTHH:mm when a single event date is known; use an empty string when unavailable.
- Use startDate/endDate only for an explicit date range; otherwise use empty strings.
- Never invent a year, date, time, timezone, deadline, weight, or requirement.
- Resolve missing years only when the term/year is unambiguous in the document.
- A due date is not an issue/release date; an exam is not an assignment; a class meeting is not a deadline.
- Preserve ambiguous or conflicting wording in dateText/sourceQuote and set confidence to "low".

CLASSIFICATION
Use exactly one type: assignment, exam, quiz, midterm, final, project, lab, homework, presentation, paper, lecture,
meeting, reading, holiday, break, deadline, review, or other. Use the most specific supported type and never infer that
an event is graded merely because it appears in a schedule.

OUTPUT CONTRACT
Return exactly one JSON object with an "items" array and "keyInfo" object. Return JSON only: no Markdown, comments, or prose.
Each item must contain:
{
  "id": "stable unique ID such as event-001",
  "title": "concise supported title",
  "type": "one allowed type",
  "dateText": "original date wording or empty string",
  "dueDate": "YYYY-MM-DD or YYYY-MM-DDTHH:mm or empty string",
  "startDate": "YYYY-MM-DD or empty string",
  "endDate": "YYYY-MM-DD or empty string",
  "weight": "explicit points/weight or empty string",
  "description": "brief supported description or empty string",
  "location": "explicit location or empty string",
  "sourceQuote": "short verbatim evidence or empty string",
  "sourcePage": 1,
  "confidence": "high, medium, or low"
}
Use sourcePage only when known; omit it for website text or unknown pages. IDs must be unique and stable within this response.
Source quotes must be verbatim and short. Confidence describes evidence quality, not plausibility.

keyInfo must contain:
{"courseName":"","courseCode":"","instructor":"","semester":"","overview":"","meetingSchedule":"","location":"",
"gradingPolicy":"","readings":[],"requiredMaterials":[],"policies":[],"officeHours":"","importantNotes":[]}
Use empty strings/arrays for unavailable values. Keep summaries concise and factual.

Before returning, verify the entire document was considered, duplicates were reconciled, dates are real calendar dates,
all types are allowed, every event has evidence when available, and no unsupported facts were added.`;

    let preprocessedText = documentText?.trim() || '';
    if (!preprocessedText && cleanBase64) {
      try {
        preprocessedText = await extractPdfText(Buffer.from(cleanBase64, 'base64'));
      } catch (error) {
        console.warn('Local PDF text extraction failed:', error);
      }
    }

    const sourceContext = sourceUrl ? `Source webpage: ${sourceUrl}\n\n` : '';
    if (isGemmaModel && preprocessedText.length < 40) {
      return res.status(422).json({
        error: 'PDF preprocessing failed',
        message:
          'The PDF did not contain enough extractable text for Gemma. Use a text-based PDF or run OCR on the scanned document before uploading it.',
      });
    }

    const contents = preprocessedText.length >= 40
      ? [{ text: `${sourceContext}PREPROCESSED DOCUMENT TEXT:\n${limitModelText(preprocessedText)}\n\n${promptText}` }]
      : [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: cleanBase64,
            },
          },
          { text: promptText },
        ];

    const response = await generateAnalysis(contents, {
        maxOutputTokens: Math.min(GEMINI_MAX_OUTPUT_TOKENS, 4096),
        responseMimeType: 'application/json',
        responseSchema: isGemmaModel ? undefined : {
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
                readings: { type: Type.ARRAY, items: { type: Type.STRING } },
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
                  dateText: { type: Type.STRING, description: 'Original date wording' },
                  dueDate: { type: Type.STRING, description: 'Due date in YYYY-MM-DD or YYYY-MM-DDTHH:mm format, or empty string' },
                  startDate: { type: Type.STRING, description: 'Start date for an explicit range, or empty string' },
                  endDate: { type: Type.STRING, description: 'End date for an explicit range, or empty string' },
                  weight: { type: Type.STRING, description: 'Percentage or point weight' },
                  description: { type: Type.STRING, description: 'Summary of the assignment or exam' },
                  location: { type: Type.STRING, description: 'Room, building, platform, or location' },
                  sourceQuote: { type: Type.STRING, description: 'Short source evidence quote' },
                  sourcePage: { type: Type.INTEGER, description: '1-based source PDF page when available' },
                  confidence: { type: Type.STRING, description: 'high, medium, or low' },
                },
                required: ['id', 'title', 'type', 'dueDate', 'weight'],
              },
            },
          },
          required: ['items'],
        },
      });

    const outputText = response.text;
    if (!outputText) {
      throw new Error('Gemini API returned an empty response.');
    }

    let parsedData: Record<string, unknown>;
    try {
      parsedData = normalizeAnalysisResult(parseModelJson(outputText));
    } catch (parseError) {
      console.warn('Model returned malformed JSON; requesting a syntax-only repair.', parseError);
      parsedData = normalizeAnalysisResult(await repairModelJson(
        outputText,
        '{"items":[{"id":"string","title":"string","type":"string","dueDate":"string"}],"keyInfo":{}}'
      ));
    }
    analysisCache.set(cacheKey, parsedData);
    return res.json({
      success: true,
      data: parsedData,
      rawTokens: response.usageMetadata,
    });
  } catch (error: any) {
    console.error('Error in /api/analyze-pdf:', error);
    const providerMessage = error?.message || 'Failed to analyze the supplied document.';
    return res.status(500).json({
      error: 'Analysis Failed',
      message: `Model "${GEMINI_MODEL}" failed to process this request. If fallback was attempted, verify "${GEMINI_FALLBACK_MODEL}" is available for your API key. Provider response: ${providerMessage}`,
    });
  }
});

app.post('/api/generate-prep', async (req: Request, res: Response) => {
  try {
    const { documentKey, event, documentText } = req.body;
    if (!event || typeof event.id !== 'string' || typeof event.title !== 'string') {
      return res.status(400).json({ error: 'Missing event', message: 'Provide an event to generate a study plan for.' });
    }
    if (!hasGeminiApiKey || !ai) {
      return res.status(500).json({ error: 'Missing GEMINI_API_KEY', message: 'Add a valid Gemini API key and restart the server.' });
    }
    const cacheKey = `${documentKey || documentCacheKey(documentText || '')}:${event.id}`;
    const cached = prepCache.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached, cached: true });
    const prompt = `Create a concise, practical revision plan for this academic event.
Use only the supplied document context and event facts. Return JSON only.
Event: ${JSON.stringify(event)}
Return an object with:
- id: "prep-${event.id}"
- duration: realistic total preparation time
- summary: specific study checklist, brief but useful
- prepDate: recommended start date YYYY-MM-DD
- milestones: 2 to 4 study blocks, each with id, dayOffset (days before due date), title, durationMinutes.
Do not invent facts not supported by the document.`;
    const context = typeof documentText === 'string' && documentText.trim()
      ? `DOCUMENT CONTEXT:\n${limitModelText(documentText.trim())}\n\n`
      : '';
    const response = await generateAnalysis([{ text: `${context}${prompt}` }], {
      maxOutputTokens: Math.min(GEMINI_MAX_OUTPUT_TOKENS, 4096),
      responseMimeType: 'application/json',
      responseSchema: isGemmaModel ? undefined : {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING }, duration: { type: Type.STRING }, summary: { type: Type.STRING },
          prepDate: { type: Type.STRING },
          milestones: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING }, dayOffset: { type: Type.INTEGER },
                title: { type: Type.STRING }, durationMinutes: { type: Type.INTEGER },
              },
              required: ['id', 'title'],
            },
          },
        },
        required: ['id', 'duration', 'summary'],
      },
    });
    if (!response.text) throw new Error('Gemini API returned an empty preparation plan.');
    let prep: unknown;
    try {
      prep = parseModelJson(response.text);
    } catch (parseError) {
      console.warn('Preparation response was malformed JSON; requesting a syntax-only repair.', parseError);
      prep = await repairModelJson(
        response.text,
        '{"id":"string","duration":"string","summary":"string","prepDate":"string","milestones":[]}'
      );
    }
    if (!prep || typeof prep !== 'object' || Array.isArray(prep)) throw new Error('The model returned an invalid preparation plan.');
    const normalizedPrep = prep as Record<string, unknown>;
    prepCache.set(cacheKey, normalizedPrep);
    return res.json({ success: true, data: normalizedPrep });
  } catch (error: any) {
    console.error('Error in /api/generate-prep:', error);
    return res.status(500).json({ error: 'Preparation generation failed', message: error?.message || 'Unable to generate a study plan.' });
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
