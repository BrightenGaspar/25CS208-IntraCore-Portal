'use strict';

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const multer = require('multer');
const exifr = require('exifr');

const DEFAULT_PROFILE = {
  name: 'Alex Morgan',
  gender: 'male',
  age: 28,
  height: 175,
  weight: 74.5,
  targetWeight: 68,
  goal: 'loss',
  pace: 0.5,
  activity: 1.55,
  diet: 'balanced',
  wakeTime: '06:30',
  sleepTime: '22:30'
};

const PROFILE_CHOICES = {
  gender: ['male', 'female'],
  goal: ['loss', 'gain', 'maintain'],
  pace: [0.25, 0.5, 0.75],
  activity: [1.2, 1.375, 1.55, 1.725, 1.9],
  diet: ['balanced', 'high_protein', 'vegetarian', 'keto']
};
const TASK_ID_PATTERN = /^[a-z0-9_]{1,40}$/;
const MEAL_NAMES = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const uploadMealPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, callback) {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return callback(new HttpError(415, 'Upload a JPEG, PNG, or WebP meal photo.'));
    }
    return callback(null, true);
  }
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function dateString(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function createDefaultState() {
  const today = new Date();
  const logs = [
    { daysAgo: 28, weight: 76.8, note: 'Example baseline' },
    { daysAgo: 21, weight: 76.1, note: 'Example week 1 check-in' },
    { daysAgo: 14, weight: 75.5, note: 'Example week 2 check-in' },
    { daysAgo: 7, weight: 74.9, note: 'Example week 3 check-in' },
    { daysAgo: 0, weight: 74.5, note: 'Example current check-in' }
  ].map((entry) => {
    const date = new Date(today);
    date.setDate(date.getDate() - entry.daysAgo);
    return {
      id: randomUUID(),
      date: dateString(date),
      weight: entry.weight,
      note: entry.note
    };
  });

  return {
    profile: { ...DEFAULT_PROFILE },
    weightLogs: logs,
    completedTasks: {},
    mealProofs: []
  };
}

function writeDb(dbFile, state) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tempFile = `${dbFile}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempFile, dbFile);
  } catch (error) {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    throw error;
  }
}

function readDb(dbFile) {
  if (!fs.existsSync(dbFile)) {
    const state = createDefaultState();
    writeDb(dbFile, state);
    return state;
  }

  const state = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  if (
    !state ||
    typeof state !== 'object' ||
    !state.profile ||
    !Array.isArray(state.weightLogs) ||
    !state.completedTasks ||
    typeof state.completedTasks !== 'object'
  ) {
    throw new Error('Stored application data has an invalid shape.');
  }
  if (state.mealProofs === undefined) state.mealProofs = [];
  else if (!Array.isArray(state.mealProofs)) throw new Error('Stored meal photo review data is invalid.');
  return state;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requireNumber(value, field, min, max, integer) {
  const number = typeof value === 'number' ? value : Number(value);
  if (
    !Number.isFinite(number) ||
    number < min ||
    number > max ||
    (integer && !Number.isInteger(number))
  ) {
    throw new HttpError(400, `${field} must be ${integer ? 'an integer' : 'a number'} from ${min} to ${max}.`);
  }
  return number;
}

function normalizeProfile(profile) {
  if (!isObject(profile)) throw new HttpError(400, 'A profile object is required.');

  const name = typeof profile.name === 'string' ? profile.name.trim() : '';
  if (name.length < 2 || name.length > 60) {
    throw new HttpError(400, 'Name must contain 2 to 60 characters.');
  }

  const normalized = {
    name,
    gender: profile.gender,
    age: requireNumber(profile.age, 'Age', 14, 100, true),
    height: requireNumber(profile.height, 'Height', 110, 240, false),
    weight: requireNumber(profile.weight, 'Weight', 30, 300, false),
    targetWeight: requireNumber(profile.targetWeight, 'Target weight', 30, 300, false),
    goal: profile.goal,
    pace: requireNumber(profile.pace, 'Weekly pace', 0.25, 0.75, false),
    activity: requireNumber(profile.activity, 'Activity level', 1.2, 1.9, false),
    diet: profile.diet,
    wakeTime: profile.wakeTime,
    sleepTime: profile.sleepTime
  };

  for (const field of Object.keys(PROFILE_CHOICES)) {
    if (!PROFILE_CHOICES[field].includes(normalized[field])) {
      throw new HttpError(400, `Invalid ${field} selection.`);
    }
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized.wakeTime)) {
    throw new HttpError(400, 'Wake-up time must use HH:MM format.');
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized.sleepTime)) {
    throw new HttpError(400, 'Sleep time must use HH:MM format.');
  }

  return normalized;
}

function normalizeStateForSync(value) {
  if (!isObject(value) || !Array.isArray(value.weightLogs)) {
    throw new HttpError(400, 'A complete application state is required.');
  }
  if (value.weightLogs.length > 1000) throw new HttpError(400, 'Too many weight entries to sync.');

  const weightLogs = value.weightLogs.map((entry) => {
    if (!isObject(entry) || typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id)) {
      throw new HttpError(400, 'Invalid weight entry in offline data.');
    }
    if (!isValidDate(entry.date)) throw new HttpError(400, 'Invalid date in offline weight data.');
    if (typeof entry.note !== 'string' || entry.note.length > 60) {
      throw new HttpError(400, 'Invalid note in offline weight data.');
    }
    return {
      id: entry.id,
      date: entry.date,
      weight: Math.round(requireNumber(entry.weight, 'Weight', 30, 300, false) * 10) / 10,
      note: entry.note
    };
  });
  if (new Set(weightLogs.map((entry) => entry.id)).size !== weightLogs.length) {
    throw new HttpError(400, 'Offline weight entries contain duplicate identifiers.');
  }

  if (!isObject(value.completedTasks) || Object.keys(value.completedTasks).length > 365) {
    throw new HttpError(400, 'Invalid offline schedule data.');
  }
  const completedTasks = {};
  for (const [date, tasks] of Object.entries(value.completedTasks)) {
    if (!isValidDate(date) || !isObject(tasks)) throw new HttpError(400, 'Invalid offline schedule date.');
    completedTasks[date] = {};
    for (const [taskId, completed] of Object.entries(tasks)) {
      if (!TASK_ID_PATTERN.test(taskId) || typeof completed !== 'boolean') {
        throw new HttpError(400, 'Invalid offline schedule check-off.');
      }
      if (completed) completedTasks[date][taskId] = true;
    }
  }

  const mealProofs = value.mealProofs === undefined ? [] : value.mealProofs;
  if (!Array.isArray(mealProofs) || mealProofs.length > 500) {
    throw new HttpError(400, 'Invalid offline meal photo review data.');
  }

  return {
    profile: normalizeProfile(value.profile),
    weightLogs,
    completedTasks,
    mealProofs: mealProofs.map((proof) => {
      if (
        !isObject(proof) ||
        typeof proof.id !== 'string' ||
        typeof proof.mealName !== 'string' ||
        !MEAL_NAMES.includes(proof.mealName) ||
        !isValidDate(proof.date) ||
        typeof proof.uploadedAt !== 'string' ||
        !Number.isFinite(Date.parse(proof.uploadedAt)) ||
        !['flagged', 'review', 'no_obvious_flags'].includes(proof.status) ||
        typeof proof.camera !== 'string' ||
        !Array.isArray(proof.flags) ||
        proof.flags.length > 12 ||
        proof.flags.some((flag) => typeof flag !== 'string' || flag.length > 240)
      ) {
        throw new HttpError(400, 'Invalid offline meal photo review record.');
      }
      return {
        id: proof.id.slice(0, 100),
        mealName: proof.mealName,
        date: proof.date,
        uploadedAt: proof.uploadedAt,
        status: proof.status,
        camera: proof.camera.slice(0, 100),
        flags: proof.flags
      };
    })
  };
}

function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function reportError(error, res) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  return res.status(500).json({ error: 'The server could not complete the request.' });
}

function createApp(options = {}) {
  const dbFile = options.dbFile || path.join(__dirname, 'data', 'db.json');
  const staticDir = options.staticDir || path.join(__dirname, 'public');
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/state', (req, res) => {
    try {
      res.json(readDb(dbFile));
    } catch (error) {
      reportError(error, res);
    }
  });

  app.put('/api/state', (req, res) => {
    try {
      const current = readDb(dbFile);
      const state = normalizeStateForSync({
        ...req.body,
        mealProofs: req.body && req.body.mealProofs === undefined ? current.mealProofs : req.body && req.body.mealProofs
      });
      writeDb(dbFile, state);
      res.json({ state });
    } catch (error) {
      reportError(error, res);
    }
  });

  app.put('/api/profile', (req, res) => {
    try {
      if (!isObject(req.body)) throw new HttpError(400, 'A profile object is required.');
      const current = readDb(dbFile);
      current.profile = normalizeProfile({ ...current.profile, ...req.body });
      writeDb(dbFile, current);
      res.json({ profile: current.profile });
    } catch (error) {
      reportError(error, res);
    }
  });

  app.post('/api/weights', (req, res) => {
    try {
      if (!isObject(req.body)) throw new HttpError(400, 'A weight entry is required.');
      const { date, weight, note = '' } = req.body;
      if (!isValidDate(date)) throw new HttpError(400, 'A valid date in YYYY-MM-DD format is required.');
      if (typeof note !== 'string' || note.length > 60) {
        throw new HttpError(400, 'Notes must be 60 characters or fewer.');
      }

      const db = readDb(dbFile);
      const entry = {
        id: randomUUID(),
        date,
        weight: Math.round(requireNumber(weight, 'Weight', 30, 300, false) * 10) / 10,
        note: note.trim()
      };
      db.weightLogs.push(entry);
      db.weightLogs.sort((a, b) => a.date.localeCompare(b.date));
      db.profile.weight = db.weightLogs[db.weightLogs.length - 1].weight;
      writeDb(dbFile, db);
      res.status(201).json({ entry, state: db });
    } catch (error) {
      reportError(error, res);
    }
  });

  app.delete('/api/weights/:id', (req, res) => {
    try {
      const db = readDb(dbFile);
      const index = db.weightLogs.findIndex((entry) => entry.id === req.params.id);
      if (index === -1) throw new HttpError(404, 'Weight entry was not found.');

      db.weightLogs.splice(index, 1);
      const latest = [...db.weightLogs].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      if (latest) db.profile.weight = latest.weight;
      writeDb(dbFile, db);
      res.json({ state: db });
    } catch (error) {
      reportError(error, res);
    }
  });

  app.delete('/api/weights', (req, res) => {
    try {
      const db = readDb(dbFile);
      db.weightLogs = [];
      writeDb(dbFile, db);
      res.json({ state: db });
    } catch (error) {
      reportError(error, res);
    }
  });

  app.put('/api/tasks', (req, res) => {
    try {
      if (!isObject(req.body)) throw new HttpError(400, 'A task update is required.');
      const { taskId, date, completed } = req.body;
      if (typeof taskId !== 'string' || !/^[a-z0-9_]{1,40}$/.test(taskId)) {
        throw new HttpError(400, 'Invalid task identifier.');
      }
      if (!isValidDate(date)) throw new HttpError(400, 'A valid date in YYYY-MM-DD format is required.');
      if (typeof completed !== 'boolean') throw new HttpError(400, 'Task completion must be true or false.');

      const db = readDb(dbFile);
      if (!db.completedTasks[date]) db.completedTasks[date] = {};
      if (completed) {
        db.completedTasks[date][taskId] = true;
      } else {
        delete db.completedTasks[date][taskId];
      }
      writeDb(dbFile, db);
      res.json({ completedTasks: db.completedTasks });
    } catch (error) {
      reportError(error, res);
    }
  });

  app.delete('/api/tasks/:date', (req, res) => {
    try {
      if (!isValidDate(req.params.date)) throw new HttpError(400, 'A valid date in YYYY-MM-DD format is required.');
      const db = readDb(dbFile);
      delete db.completedTasks[req.params.date];
      writeDb(dbFile, db);
      res.json({ completedTasks: db.completedTasks });
    } catch (error) {
      reportError(error, res);
    }
  });

  app.post('/api/meals/verify-photo', (req, res, next) => {
    uploadMealPhoto.single('mealPhoto')(req, res, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Meal photos must be 10 MB or smaller.' });
      }
      return reportError(error, res);
    });
  }, async (req, res) => {
    try {
      if (!req.file) throw new HttpError(400, 'Choose a meal photo to review.');
      const actualType = detectImageType(req.file.buffer);
      if (!actualType || actualType !== req.file.mimetype) {
        throw new HttpError(415, 'The uploaded file does not match a supported image format.');
      }

      const mealName = req.body.mealName;
      if (!MEAL_NAMES.includes(mealName)) throw new HttpError(400, 'Choose a scheduled meal.');
      const date = req.body.date || dateString(new Date());
      if (!isValidDate(date)) throw new HttpError(400, 'A valid upload date is required.');

      const flags = [];
      const explicitAiMarkers = [
        'trainedAlgorithmicMedia',
        'Midjourney',
        'DALL-E',
        'Stable Diffusion',
        'Adobe Firefly',
        'ComfyUI',
        'AUTOMATIC1111',
        'Imagen'
      ];
      const embeddedText = req.file.buffer.toString('latin1').toLowerCase();
      const matchedMarkers = explicitAiMarkers.filter((marker) => embeddedText.includes(marker.toLowerCase()));
      if (matchedMarkers.length) {
        flags.push(`Image metadata contains a known AI-tool marker: ${matchedMarkers.join(', ')}.`);
      }
      if (embeddedText.includes('c2pa')) {
        flags.push('Content Credentials metadata was found; review its provenance rather than treating it as proof of AI use.');
      }
      if (/^(download|images(?: \(\d+\))?|untitled|screenshot|whatsapp|fb_img)/i.test(req.file.originalname)) {
        flags.push('Filename resembles a downloaded or shared image; filenames are only a weak signal.');
      }

      let metadata = null;
      try {
        metadata = await exifr.parse(req.file.buffer, {
          pick: ['Make', 'Model', 'Software', 'DateTimeOriginal']
        });
      } catch (error) {
        console.warn('Meal photo metadata could not be read:', error.message);
        flags.push('Image metadata could not be read.');
      }

      if (!metadata || (!metadata.Make && !metadata.Model)) {
        flags.push('No camera make/model metadata was found; metadata may be stripped from legitimate photos.');
      }
      if (metadata && typeof metadata.Software === 'string' && /chrome|midjourney|firefly|stable diffusion|comfyui/i.test(metadata.Software)) {
        flags.push(`Image software metadata reports "${metadata.Software}".`);
      }
      if (metadata && metadata.DateTimeOriginal) {
        const captureTime = new Date(metadata.DateTimeOriginal).getTime();
        if (Number.isFinite(captureTime)) {
          const ageMinutes = (Date.now() - captureTime) / 60000;
          if (ageMinutes > 15 || ageMinutes < -5) {
            flags.push('Capture time is outside the 15-minute freshness window; camera clocks and time zones can affect this check.');
          }
        } else {
          flags.push('Capture time metadata could not be interpreted.');
        }
      }

      const status = matchedMarkers.length ? 'flagged' : flags.length ? 'review' : 'no_obvious_flags';
      const record = {
        id: randomUUID(),
        mealName,
        date,
        uploadedAt: new Date().toISOString(),
        status,
        camera: metadata && (metadata.Make || metadata.Model)
          ? [metadata.Make, metadata.Model].filter(Boolean).join(' ').slice(0, 100)
          : 'Unknown',
        flags
      };

      const db = readDb(dbFile);
      db.mealProofs.push(record);
      if (db.mealProofs.length > 500) db.mealProofs.shift();
      writeDb(dbFile, db);
      res.status(201).json({
        record,
        note: 'Metadata checks can flag clues but cannot prove when, where, or how an image was created.'
      });
    } catch (error) {
      reportError(error, res);
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ error: 'Request body must contain valid JSON.' });
    }
    return next(error);
  });

  app.use(express.static(staticDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });

  app.use((error, req, res, next) => {
    reportError(error, res);
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
  createApp().listen(port, host, () => {
    console.log(`VitalCore is running at http://${host}:${port}`);
  });
}

module.exports = { createApp };
