const AppError = require('../utils/AppError');
const { validateRequiredString } = require('../utils/validators');
const { gemini: geminiConfig } = require('../config/env');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_WORD_LENGTH = 100;

/** Campos de texto obligatorios en la respuesta de Gemini. */
const REQUIRED_STRING_FIELDS = [
  'word',
  'translation',
  'grammar_family',
  'grammar_category',
  'example',
  'example_translation',
  'pronunciation',
];

/** Campos de lista en la respuesta de Gemini (pueden venir vacíos, pero deben ser listas). */
const REQUIRED_ARRAY_FIELDS = ['synonyms', 'antonyms', 'collocations'];

/**
 * Construye el prompt EXACTO que debe recibir la API de Gemini.
 * Solo se interpola la palabra, ya saneada (sin comillas ni saltos de línea
 * para no romper el formato del prompt).
 */
function buildWordPrompt(word) {
  return (
    `Necesito que extraigas para la palabra "${word}" los siguientes campos en formato JSON:\n` +
    '- word (la palabra original)\n' +
    '- translation (traducción al español)\n' +
    '- grammar_family (familia gramatical)\n' +
    '- grammar_category (categoría gramatical)\n' +
    '- synonyms (lista de sinónimos)\n' +
    '- antonyms (lista de antónimos)\n' +
    '- collocations (colocaciones comunes)\n' +
    '- example (oración de ejemplo en inglés)\n' +
    '- example_translation (traducción del ejemplo al español)\n' +
    '- pronunciation (pronunciación)'
  );
}

/** Sanea la palabra antes de interpolarla en el prompt. */
function sanitizeWord(rawWord) {
  const clean = validateRequiredString(rawWord, 'word');
  if (clean.length > MAX_WORD_LENGTH) {
    throw new AppError(`word no debe superar ${MAX_WORD_LENGTH} caracteres`, 400);
  }
  return clean.replace(/["\r\n\t\\]/g, '').trim();
}

/** Extrae el texto generado del primer candidato de la respuesta REST. */
function extractGeneratedText(apiResponse) {
  const parts = apiResponse?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new AppError('Gemini devolvió una respuesta sin contenido utilizable', 502);
  }
  const text = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
  if (!text) {
    throw new AppError('Gemini devolvió una respuesta sin contenido utilizable', 502);
  }
  return text;
}

/** Quita fences de markdown (```json ... ```) si Gemini los añade. */
function stripCodeFences(text) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

/** Normaliza un campo de lista: string suelto → [string], no-lista → []. */
function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

/**
 * Valida y normaliza el JSON de Gemini al contrato de 10 campos.
 * Rellena listas ausentes con [] pero exige los campos de texto:
 * si falta alguno o el JSON está malformado, lanza AppError 502 para que
 * el llamador distinga "falló el proveedor" de un error propio.
 */
function parseWordData(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(rawText));
  } catch {
    throw new AppError('Gemini devolvió un JSON malformado', 502);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('Gemini devolvió un JSON malformado', 502);
  }

  const missing = REQUIRED_STRING_FIELDS.filter(
    (field) => typeof parsed[field] !== 'string' || !parsed[field].trim()
  );
  if (missing.length > 0) {
    throw new AppError(
      `Gemini devolvió datos incompletos (faltan: ${missing.join(', ')})`,
      502
    );
  }

  return {
    word: parsed.word.trim(),
    translation: parsed.translation.trim(),
    grammar_family: parsed.grammar_family.trim(),
    grammar_category: parsed.grammar_category.trim(),
    synonyms: normalizeStringList(parsed.synonyms),
    antonyms: normalizeStringList(parsed.antonyms),
    collocations: normalizeStringList(parsed.collocations),
    example: parsed.example.trim(),
    example_translation: parsed.example_translation.trim(),
    pronunciation: parsed.pronunciation.trim(),
  };
}

function resolveApiKey(override) {
  const apiKey = override || geminiConfig.apiKey;
  if (!apiKey) {
    throw new AppError('GEMINI_API_KEY no configurada en el servidor', 500);
  }
  return apiKey;
}

/**
 * Solicita a Gemini API los datos lingüísticos de una palabra en inglés
 * y devuelve el objeto estructurado de 10 campos.
 *
 * @param {string} rawWord Palabra a consultar.
 * @param {object} [options]
 * @param {string} [options.apiKey] Override de GEMINI_API_KEY (útil en tests).
 * @param {string} [options.model] Override de GEMINI_MODEL.
 * @param {number} [options.timeoutMs=30000] Timeout de la petición.
 * @param {number} [options.fieldRetries=2] Reintentos ante JSON malformado
 *   o campos faltantes (el modelo a veces omite campos; suele bastar con
 *   pedir de nuevo).
 * @returns {Promise<object>} Datos estructurados de la palabra.
 * @throws {AppError} 400 palabra inválida · 500 sin API key ·
 *   502 respuesta malformada/incompleta o error no reintentable ·
 *   429/503 si el proveedor sigue saturado tras los reintentos.
 */
async function getWordData(rawWord, options = {}) {
  const word = sanitizeWord(rawWord);
  const fieldRetries = options.fieldRetries ?? 2;

  let lastError;
  for (let attempt = 1; attempt <= fieldRetries + 1; attempt += 1) {
    const { text: generatedText, model } = await callGemini(
      buildWordPrompt(word),
      attempt > 1 ? `${word} (reintento ${attempt})` : word,
      options
    );

    try {
      const data = parseWordData(generatedText);
      console.log('[gemini] Datos obtenidos:', { word, model });
      return data;
    } catch (error) {
      lastError = error;
      if (attempt <= fieldRetries) {
        console.warn('[gemini] Respuesta incompleta, reintentando:', {
          word,
          attempt,
          message: error?.message,
        });
      }
    }
  }

  throw lastError;
}

/**
 * Traduce un lote de palabras inglesas al español en UNA sola petición.
 * Devuelve un mapa `{ "English": "traducción" }` solo con las entradas
 * válidas; las que Gemini omita o devuelva vacías no aparecen en el mapa
 * (el llamador decide qué hacer con ellas).
 *
 * @param {string[]} words Lista de palabras en inglés.
 * @param {object} [options] Mismas opciones que getWordData.
 * @returns {Promise<Object<string, string>>}
 */
async function translateWords(words, options = {}) {
  const clean = [...new Set(
    (Array.isArray(words) ? words : [])
      .filter((w) => typeof w === 'string')
      .map((w) => w.trim().replace(/["\r\n\t\\]/g, ''))
      .filter(Boolean)
  )];

  if (clean.length === 0) return {};

  const prompt =
    'Traduce al español cada una de estas palabras inglesas. ' +
    'Responde SOLO con un objeto JSON donde cada clave es la palabra original ' +
    'en inglés y cada valor su traducción al español. ' +
    `Palabras: ${JSON.stringify(clean)}`;

  const { text } = await callGemini(prompt, `lote(${clean.length})`, options);

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    throw new AppError('Gemini devolvió un JSON malformado en la traducción en lote', 502);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('Gemini devolvió un JSON malformado en la traducción en lote', 502);
  }

  const map = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.trim()) {
      map[key] = value.trim();
    }
  }

  // Normaliza claves insensibles a mayúsculas: el mapa se consulta por término.
  const byLower = {};
  for (const term of clean) {
    const hit = Object.keys(map).find((k) => k.toLowerCase() === term.toLowerCase());
    if (hit) byLower[term] = map[hit];
  }

  console.log('[gemini] Lote traducido:', { requested: clean.length, translated: Object.keys(byLower).length });
  return byLower;
}

const MAX_EXAMPLE_LENGTH = 1000;

/**
 * Genera una imagen ilustrativa del ejemplo en inglés con el modelo
 * de imagen de Gemini (Nano Banana). Devuelve el binario + mimeType,
 * listo para subir a Cloudinary.
 *
 * @param {string} rawExample Oración de ejemplo en inglés.
 * @param {object} [options]
 * @param {string} [options.imageModel] Override de GEMINI_IMAGE_MODEL.
 * @param {string} [options.scene] Prompt ya construido (lo usa
 *   illustrationService para unificar el estilo entre proveedores).
 *   Resto de opciones iguales a getWordData.
 * @returns {Promise<{ buffer: Buffer, mimeType: string }>}
 */
async function generateIllustration(rawExample, options = {}) {
  const example = validateRequiredString(rawExample, 'example');
  if (example.length > MAX_EXAMPLE_LENGTH) {
    throw new AppError(`example no debe superar ${MAX_EXAMPLE_LENGTH} caracteres`, 400);
  }

  const prompt =
    options.scene ||
    'Generate a simple, clear, colorful illustrative image depicting this scene. ' +
      'No text, no words, no letters in the image. ' +
      `Scene: "${example}"`;

  const { response, model } = await callGemini(prompt, 'ilustración', {
    ...options,
    model: options.imageModel || geminiConfig.imageModel,
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    rawResponse: true,
  });

  const candidates = response?.candidates || [];
  for (const candidate of candidates) {
    for (const part of candidate?.content?.parts || []) {
      const inline = part?.inlineData || part?.inline_data;
      const mimeType = inline?.mimeType || inline?.mime_type || '';
      if (inline?.data && mimeType.startsWith('image/')) {
        console.log('[gemini] Ilustración generada:', { model, mimeType });
        return { buffer: Buffer.from(inline.data, 'base64'), mimeType };
      }
    }
  }

  throw new AppError('Gemini no devolvió ninguna imagen ilustrativa', 502);
}

/**
 * Estados transitorios del proveedor que ameritan reintento (con backoff).
 */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 8000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff exponencial; respeta `Retry-After` si Google lo envía. */
function retryDelayMs(failedAttempt, response) {
  const header = response?.headers?.get?.('retry-after');
  const secs = header ? parseInt(header, 10) : NaN;
  if (!Number.isNaN(secs)) return Math.min(Math.max(secs, 0) * 1000, MAX_BACKOFF_MS);
  return Math.min(1000 * 2 ** (failedAttempt - 1), MAX_BACKOFF_MS);
}

/**
 * Llamada genérica a Gemini: envía un prompt y devuelve el texto generado.
 * Centraliza timeout, errores de red/proveedor y bloqueos. Reintenta hasta
 * MAX_ATTEMPTS ante errores transitorios (429/503/...); los 429/503 finales
 * se propagan con su estado original para que el cliente sepa que puede
 * reintentar, el resto de fallos del proveedor son 502.
 */
async function callGemini(prompt, label, options = {}) {
  const apiKey = resolveApiKey(options.apiKey);
  const model = options.model || geminiConfig.model;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts || MAX_ATTEMPTS;

  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
  const generationConfig = options.generationConfig || {
    responseMimeType: 'application/json',
    temperature: 0.2,
  };
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    // Modo JSON sin alterar el prompt: solo guía el formato de salida.
    generationConfig,
  });

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: payload,
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === 'AbortError') {
        throw new AppError('Gemini no respondió a tiempo', 503);
      }
      lastError = new AppError('No se pudo contactar con Gemini', 503);
      console.error('[gemini] Error de red:', { label, attempt, message: error?.message });
    }

    if (response) {
      if (response.ok) {
        clearTimeout(timer);
        let apiResponse;
        try {
          apiResponse = await response.json();
        } catch {
          throw new AppError('Gemini devolvió una respuesta ilegible', 502);
        }

        if (apiResponse?.promptFeedback?.blockReason) {
          throw new AppError(
            `Gemini bloqueó la solicitud (${apiResponse.promptFeedback.blockReason})`,
            502
          );
        }

        if (attempt > 1) console.log('[gemini] Reintento exitoso:', { label, attempt });
        if (options.rawResponse) return { response: apiResponse, model };
        return { text: extractGeneratedText(apiResponse), model };
      }

      clearTimeout(timer);
      let detail = '';
      try {
        detail = await response.text();
      } catch {
        // sin cuerpo legible
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt < maxAttempts) {
        const waitMs = retryDelayMs(attempt, response);
        console.warn('[gemini] Error transitorio, reintentando:', {
          label,
          status: response.status,
          attempt,
          waitMs,
        });
        await sleep(waitMs);
        continue;
      }

      console.error('[gemini] Proveedor respondió con error:', {
        label,
        status: response.status,
        detail: detail.slice(0, 300),
      });
      const status = response.status === 429 || response.status === 503 ? response.status : 502;
      throw new AppError(`Gemini respondió con error (HTTP ${response.status})`, status);
    }

    if (attempt < maxAttempts) {
      const waitMs = retryDelayMs(attempt);
      console.warn('[gemini] Error de red, reintentando:', { label, attempt, waitMs });
      await sleep(waitMs);
    }
  }

  throw lastError || new AppError('No se pudo contactar con Gemini', 503);
}

module.exports = {
  getWordData,
  translateWords,
  generateIllustration,
  buildWordPrompt,
  parseWordData,
};
