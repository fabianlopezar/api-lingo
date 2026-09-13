const cloudinary = require('cloudinary').v2;
const AppError = require('../utils/AppError');
const { cloudinary: cloudinaryConfig } = require('../config/env');

const FOLDER = 'colibri/words';
let configured = false;

function isCloudinaryConfigured() {
  return Boolean(
    cloudinaryConfig.cloudName && cloudinaryConfig.apiKey && cloudinaryConfig.apiSecret
  );
}

function ensureConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new AppError(
      'Cloudinary no configurado (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)',
      500
    );
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: cloudinaryConfig.cloudName,
      api_key: cloudinaryConfig.apiKey,
      api_secret: cloudinaryConfig.apiSecret,
      timeout: 60000,
    });
    configured = true;
  }
}

/**
 * Sube el binario de una ilustración a Cloudinary y devuelve la URL segura.
 *
 * @param {Buffer} buffer Binario de la imagen.
 * @param {string} publicId Identificador único (sin carpeta).
 * @returns {Promise<string>} secure_url de la imagen.
 */
async function uploadIllustration(buffer, publicId) {
  ensureConfigured();

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError('Imagen vacía, nada que subir a Cloudinary', 400);
  }

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: FOLDER, public_id: publicId, resource_type: 'image' },
        (error, uploaded) => (error ? reject(error) : resolve(uploaded))
      );
      stream.end(buffer);
    });

    if (!result?.secure_url) {
      throw new AppError('Cloudinary no devolvió URL para la ilustración', 502);
    }

    console.log('[cloudinary] Ilustración subida:', { publicId, url: result.secure_url });
    return result.secure_url;
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('[cloudinary] Subida fallida:', { publicId, message: error?.message });
    throw new AppError('No se pudo subir la ilustración a Cloudinary', 502);
  }
}

module.exports = {
  isCloudinaryConfigured,
  uploadIllustration,
};
