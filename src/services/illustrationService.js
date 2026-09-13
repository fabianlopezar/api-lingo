const AppError = require('../utils/AppError');
const { validateRequiredString } = require('../utils/validators');
const { illustration: illustrationConfig, openrouter: openrouterConfig } = require('../config/env');
const geminiService = require('./geminiService');

const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';
const POLLINATIONS_TIMEOUT_MS = 90000;
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TIMEOUT_MS = 90000;

/**
 * Prompt estilo "diccionario ilustrado": un solo objeto/escena claro con
 * la palabra y su ejemplo como contexto, prohibiendo texto en la imagen
 * (los modelos suelen deformar las letras).
 */
function buildScenePrompt(example, { word, translation } = {}) {
  const subject = word
    ? `the English word "${word}"${translation ? ` (Spanish: "${translation}")` : ''}`
    : 'the scene below';
  return (
    `Children's picture-dictionary illustration for ${subject}. ` +
    'Depict ONE single, clear, easily recognizable scene. ' +
    'Flat vector style, bright friendly colors, minimal plain background, ' +
    'one focal object, no clutter. ' +
    'ABSOLUTELY NO text, words, letters, numbers, labels or watermarks in the image. ' +
    `Scene: "${example}"`
  );
}

/**
 * Genera la ilustración con Pollinations.ai (gratis, sin API key):
 * GET al prompt y la respuesta ES la imagen.
 */
async function generateWithPollinations(example, scene, options = {}) {
  const model = options.pollinationsModel || illustrationConfig.pollinationsModel;
  const size = options.pollinationsSize || illustrationConfig.pollinationsSize;
  const timeoutMs = options.timeoutMs || POLLINATIONS_TIMEOUT_MS;

  const url =
    `${POLLINATIONS_BASE}/${encodeURIComponent(scene)}` +
    `?width=${size}&height=${size}&nologo=true&model=${encodeURIComponent(model)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AppError('Pollinations no respondió a tiempo', 503);
    }
    throw new AppError('No se pudo contactar con Pollinations', 503);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new AppError(`Pollinations respondió con error (HTTP ${response.status})`, 502);
  }

  const contentType = response.headers?.get?.('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new AppError('Pollinations no devolvió una imagen', 502);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new AppError('Pollinations devolvió una imagen vacía', 502);
  }

  console.log('[illustration] Imagen generada con Pollinations:', {
    model,
    bytes: buffer.length,
    mimeType: contentType,
  });
  return { buffer, mimeType: contentType };
}

function resolveOpenRouterKey(override) {
  const apiKey = override || openrouterConfig.apiKey;
  if (!apiKey) {
    throw new AppError(
      'OPENROUTER_API_KEY no configurada (solo se necesita si el proveedor openrouter participa)',
      500
    );
  }
  return apiKey;
}

/** Extrae el binario de un data-URI `data:<mime>;base64,...`. */
function parseDataUri(dataUri) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUri || '');
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  return buffer.length > 0 ? { buffer, mimeType: match[1] } : null;
}

/**
 * Genera la ilustración con OpenRouter (modelos con modalities image+text).
 * La respuesta trae `choices[0].message.images[].image_url.url` (data-URI).
 */
async function generateWithOpenRouter(example, scene, options = {}) {
  const apiKey = resolveOpenRouterKey(options.openRouterApiKey);
  const model = options.openRouterImageModel || openrouterConfig.imageModel;
  const timeoutMs = options.timeoutMs || OPENROUTER_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(OPENROUTER_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: scene }],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AppError('OpenRouter no respondió a tiempo', 503);
    }
    throw new AppError('No se pudo contactar con OpenRouter', 503);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      // sin cuerpo legible
    }
    console.error('[illustration] OpenRouter respondió con error:', {
      model,
      status: response.status,
      detail: detail.slice(0, 300),
    });
    const status =
      response.status === 429 || response.status === 503 || response.status === 402
        ? response.status
        : 502;
    throw new AppError(`OpenRouter respondió con error (HTTP ${response.status})`, status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new AppError('OpenRouter devolvió una respuesta ilegible', 502);
  }

  const images = payload?.choices?.[0]?.message?.images || [];
  for (const image of images) {
    const parsed = parseDataUri(image?.image_url?.url);
    if (parsed) {
      console.log('[illustration] Imagen generada con OpenRouter:', {
        model,
        bytes: parsed.buffer.length,
        mimeType: parsed.mimeType,
      });
      return parsed;
    }
  }

  throw new AppError('OpenRouter no devolvió ninguna imagen', 502);
}

function isRetryableIllustrationError(error) {
  // 429/503 = saturación transitoria; 402 = sin fondos/cuota en ese
  // proveedor (p. ej. OpenRouter HTTP 402): no tiene sentido reintentar
  // ahí mismo, pero sí pasar al siguiente eslabón (Pollinations es gratis).
  return error?.statusCode === 429 || error?.statusCode === 503 || error?.statusCode === 402;
}

/**
 * Genera la ilustración del ejemplo según el proveedor configurado
 * (`ILLUSTRATION_PROVIDER`: auto | gemini | openrouter | pollinations).
 *
 * - `auto` (default): Gemini → OpenRouter → Pollinations. Cada eslabón
 *   solo se intenta si el anterior falla con 429/503; un error real
 *   (400/404/500 de config) propaga sin seguir la cadena.
 *
 * @param {string} example Oración de ejemplo en inglés.
 * @param {object} [options] `{ word, translation }` enriquecen el prompt.
 * @returns {Promise<{ buffer: Buffer, mimeType: string, provider: string }>}
 */
async function generateIllustration(example, options = {}) {
  const clean = validateRequiredString(example, 'example');
  const provider = (options.provider || illustrationConfig.provider || 'auto').toLowerCase();
  const scene = buildScenePrompt(clean, options);

  if (provider === 'pollinations') {
    const image = await generateWithPollinations(clean, scene, options);
    return { ...image, provider: 'pollinations' };
  }

  if (provider === 'openrouter') {
    const image = await generateWithOpenRouter(clean, scene, options);
    return { ...image, provider: 'openrouter' };
  }

  if (provider === 'gemini') {
    const image = await geminiService.generateIllustration(clean, {
      ...options,
      scene,
    });
    return { ...image, provider: 'gemini' };
  }

  // auto: cadena de fallbacks ante saturación/cuota.
  const chain = [
    ['gemini', () => geminiService.generateIllustration(clean, { ...options, scene })],
    ['openrouter', () => generateWithOpenRouter(clean, scene, options)],
    ['pollinations', () => generateWithPollinations(clean, scene, options)],
  ];

  let lastError;
  for (const [name, run] of chain) {
    try {
      const image = await run();
      return { ...image, provider: name };
    } catch (error) {
      lastError = error;
      if (!isRetryableIllustrationError(error)) throw error;
      console.warn(`[illustration] ${name} saturado, siguiente fallback:`, {
        message: error?.message,
      });
    }
  }

  throw lastError;
}

module.exports = {
  generateIllustration,
  buildScenePrompt,
};
