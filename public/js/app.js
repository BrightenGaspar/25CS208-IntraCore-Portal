'use strict';

const $ = (selector) => document.querySelector(selector);
const state = {
  profile: null,
  weightLogs: [],
  completedTasks: {},
  mealProofs: [],
  activeTab: 'overview'
};

const CACHE_KEY = 'vitalcore-local-cache-v1';
let offlineDirty = false;

const OFFLINE_DEFAULTS = {
  profile: {
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
  },
  weightLogs: [],
  completedTasks: {},
  mealProofs: []
};

const dietLabels = {
  balanced: 'Balanced plan',
  high_protein: 'Higher-protein plan',
  vegetarian: 'Vegetarian plan',
  keto: 'Low-carbohydrate plan'
};

const mealTemplates = {
  balanced: {
    breakfast: ['Oats, yogurt and berries', 'Oats with milk or yogurt, fruit and a small handful of nuts.'],
    lunch: ['Protein and grain bowl', 'Add beans, tofu, chicken or another protein with vegetables and a grain.'],
    snack: ['Fruit and yogurt', 'A simple snack with fruit and a protein source.'],
    dinner: ['Vegetables and protein', 'A balanced plate with vegetables, protein and a filling carbohydrate.']
  },
  high_protein: {
    breakfast: ['Eggs or yogurt with whole grains', 'Choose eggs, Greek yogurt or tofu with fruit or whole-grain toast.'],
    lunch: ['Protein-forward lunch bowl', 'Include beans, tofu, fish or lean meat, vegetables and a grain.'],
    snack: ['Cottage cheese or roasted chickpeas', 'Choose a protein-rich snack that suits your preferences.'],
    dinner: ['Tofu, fish or lean protein', 'Pair a protein source with vegetables and a carbohydrate of choice.']
  },
  vegetarian: {
    breakfast: ['Yogurt, oats and fruit', 'Add nuts or seeds for texture and a satisfying start.'],
    lunch: ['Lentil and grain bowl', 'Combine lentils or beans, whole grains, vegetables and yogurt or tofu.'],
    snack: ['Fruit and roasted chickpeas', 'A flexible snack with fiber and plant-based protein.'],
    dinner: ['Tofu or paneer with vegetables', 'Serve with a grain or flatbread and a variety of vegetables.']
  },
  keto: {
    breakfast: ['Eggs or tofu with vegetables', 'Use ingredients that fit your own preferences and health needs.'],
    lunch: ['Salad with a protein source', 'Add leafy vegetables and a protein such as tofu, eggs or fish.'],
    snack: ['Nuts and a low-sugar option', 'A small portion of nuts with a snack you enjoy.'],
    dinner: ['Protein and non-starchy vegetables', 'Pair a protein source with vegetables and a suitable fat.']
  }
};

async function api(url, options = {}) {
  try {
    if (offlineDirty) {
      const cachedState = readCachedState();
      const syncResponse = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cachedState)
      });
      if (isApiUnavailable(syncResponse)) {
        setOfflineStatus();
        return offlineApi(url, options);
      }
      const syncResult = await parseResponse(syncResponse);
      if (!syncResponse.ok) throw new Error(syncResult.error || `Offline data sync failed (${syncResponse.status}).`);
      Object.assign(state, syncResult.state);
      offlineDirty = false;
      storeCachedState(false);
    }

    const headers = { ...options.headers };
    if (typeof options.body === 'string') headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { ...options, headers });
    if (
      isKnownApiRoute(url, options.method || 'GET') &&
      isApiUnavailable(response)
    ) {
      setOfflineStatus();
      return offlineApi(url, options);
    }
    const result = await parseResponse(response);
    if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    applyApiResult(url, result);
    setOnlineStatus();
    storeCachedState(false);
    return result;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    setOfflineStatus();
    return offlineApi(url, options);
  }
}

function isApiUnavailable(response) {
  return [404, 405, 501].includes(response.status);
}

async function parseResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function isKnownApiRoute(url, method) {
  return (
    (url === '/api/state' && ['GET', 'PUT'].includes(method)) ||
    (url === '/api/profile' && method === 'PUT') ||
    (url === '/api/weights' && ['POST', 'DELETE'].includes(method)) ||
    (/^\/api\/weights\/[^/]+$/.test(url) && method === 'DELETE') ||
    (url === '/api/tasks' && method === 'PUT') ||
    (/^\/api\/tasks\/\d{4}-\d{2}-\d{2}$/.test(url) && method === 'DELETE') ||
    (url === '/api/meals/verify-photo' && method === 'POST')
  );
}

function readCachedState() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) return JSON.parse(JSON.stringify(OFFLINE_DEFAULTS));
  const value = JSON.parse(cached);
  if (!value || typeof value !== 'object' || !value.state || typeof value.dirty !== 'boolean') {
    throw new Error('Saved browser data has an invalid format.');
  }
  offlineDirty = value.dirty;
  return value.state;
}

function storeCachedState(dirty) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    state: {
      profile: state.profile,
      weightLogs: state.weightLogs,
      completedTasks: state.completedTasks,
      mealProofs: state.mealProofs || []
    },
    dirty
  }));
  offlineDirty = dirty;
}

function setOnlineStatus() {
  const status = $('#sync-status');
  if (!status) return;
  status.classList.remove('offline');
  status.innerHTML = '<span></span> Saved to this server';
}

function setOfflineStatus() {
  const status = $('#sync-status');
  if (!status) return;
  status.classList.add('offline');
  status.innerHTML = '<span></span> Offline · saved in this browser';
}

function applyApiResult(url, result) {
  if (url === '/api/state') Object.assign(state, result);
  else if (result.state) Object.assign(state, result.state);
  else if (result.profile) state.profile = result.profile;
  else if (result.completedTasks) state.completedTasks = result.completedTasks;
  else if (result.record) {
    state.mealProofs = [result.record, ...(state.mealProofs || []).filter((proof) => proof.id !== result.record.id)];
  }
}

function offlineApi(url, options) {
  if (url === '/api/meals/verify-photo') {
    throw new Error('Photo metadata review needs the Express backend; it cannot be performed offline.');
  }

  const method = options.method || 'GET';
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
  let result;

  if (url === '/api/state' && method === 'GET') {
    Object.assign(state, readCachedState());
    result = state;
  } else if (url === '/api/state' && method === 'PUT') {
    Object.assign(state, body);
    result = { state };
  } else if (url === '/api/profile' && method === 'PUT') {
    state.profile = { ...state.profile, ...body };
    result = { profile: state.profile };
  } else if (url === '/api/weights' && method === 'POST') {
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      date: body.date,
      weight: Math.round(Number(body.weight) * 10) / 10,
      note: String(body.note || '').trim()
    };
    if (!Number.isFinite(entry.weight) || entry.weight < 30 || entry.weight > 300 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      throw new Error('Enter a valid date and a weight from 30 to 300 kg.');
    }
    state.weightLogs.push(entry);
    state.weightLogs.sort((a, b) => a.date.localeCompare(b.date));
    state.profile.weight = state.weightLogs[state.weightLogs.length - 1].weight;
    result = { entry, state };
  } else if (url === '/api/weights' && method === 'DELETE') {
    state.weightLogs = [];
    result = { state };
  } else if (url.startsWith('/api/weights/') && method === 'DELETE') {
    const id = decodeURIComponent(url.slice('/api/weights/'.length));
    state.weightLogs = state.weightLogs.filter((entry) => entry.id !== id);
    const latest = [...state.weightLogs].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    if (latest) state.profile.weight = latest.weight;
    result = { state };
  } else if (url === '/api/tasks' && method === 'PUT') {
    const { taskId, date, completed } = body;
    if (!state.completedTasks[date]) state.completedTasks[date] = {};
    if (completed) state.completedTasks[date][taskId] = true;
    else delete state.completedTasks[date][taskId];
    result = { completedTasks: state.completedTasks };
  } else if (url.startsWith('/api/tasks/') && method === 'DELETE') {
    delete state.completedTasks[url.slice('/api/tasks/'.length)];
    result = { completedTasks: state.completedTasks };
  } else {
    throw new Error('This feature is unavailable while offline.');
  }

  storeCachedState(true);
  return result;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' error' : ''}`;
  toast.textContent = message;
  $('#toast-container').appendChild(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function formatShortDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function calculateMetrics(profile) {
  const heightM = profile.height / 100;
  const bmi = profile.weight / (heightM * heightM);
  const sexFactor = profile.gender === 'male' ? 5 : -161;
  const bmr = Math.round(10 * profile.weight + 6.25 * profile.height - 5 * profile.age + sexFactor);
  const tdee = Math.round(bmr * profile.activity);
  const dailyChange = Math.round(profile.pace * 1100);
  const minimumCalories = profile.gender === 'male' ? 1500 : 1200;
  let targetCalories = tdee;
  let calorieNote = 'Estimated maintenance energy target.';

  if (profile.goal === 'loss') {
    targetCalories = Math.max(minimumCalories, tdee - dailyChange);
    calorieNote = `Estimated ${Math.round(tdee - targetCalories).toLocaleString()} kcal/day below maintenance.`;
  } else if (profile.goal === 'gain') {
    targetCalories = tdee + dailyChange;
    calorieNote = `Estimated ${dailyChange.toLocaleString()} kcal/day above maintenance.`;
  }

  const ratios = {
    balanced: { carbs: 0.45, protein: 0.25, fats: 0.3 },
    high_protein: { carbs: 0.35, protein: 0.35, fats: 0.3 },
    vegetarian: { carbs: 0.5, protein: 0.22, fats: 0.28 },
    keto: { carbs: 0.1, protein: 0.25, fats: 0.65 }
  }[profile.diet];
  const weeks = profile.goal === 'maintain'
    ? 0
    : Math.ceil(Math.abs(profile.targetWeight - profile.weight) / profile.pace);
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + weeks * 7);
  const waterLiters = ((profile.weight * 0.033) + (profile.activity >= 1.725 ? 0.6 : profile.activity >= 1.55 ? 0.35 : 0.15));

  return {
    bmi,
    bmiCategory: bmi < 18.5 ? 'Below range' : bmi < 25 ? 'Within range' : bmi < 30 ? 'Above range' : 'High range',
    minIdealWeight: 18.5 * heightM * heightM,
    maxIdealWeight: 24.9 * heightM * heightM,
    bmr,
    tdee,
    targetCalories,
    calorieNote,
    ratios,
    proteinG: Math.round(targetCalories * ratios.protein / 4),
    carbsG: Math.round(targetCalories * ratios.carbs / 4),
    fatsG: Math.round(targetCalories * ratios.fats / 9),
    waterLiters,
    weeks,
    targetDate
  };
}

function renderOverview() {
  const p = state.profile;
  const m = calculateMetrics(p);
  $('#banner-greeting').textContent = `Welcome, ${p.name}`;
  $('#banner-summary').textContent = p.goal === 'maintain'
    ? `Planning to maintain around ${p.targetWeight.toFixed(1)} kg.`
    : `${p.goal === 'loss' ? 'Working toward' : 'Building toward'} ${p.targetWeight.toFixed(1)} kg from ${p.weight.toFixed(1)} kg.`;
  $('#metric-timeline').textContent = m.weeks ? `${m.weeks} week${m.weeks === 1 ? '' : 's'}` : 'Maintenance';
  $('#metric-target-date').textContent = m.weeks
    ? `Estimate: ${m.targetDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Flexible ongoing goal';
  $('#metric-bmi').textContent = m.bmi.toFixed(1);
  $('#bmi-badge').textContent = m.bmiCategory;
  $('#metric-bmr').textContent = m.bmr.toLocaleString();
  $('#metric-tdee').textContent = m.tdee.toLocaleString();
  $('#metric-water').textContent = `${m.waterLiters.toFixed(1)} L`;
  $('#metric-glasses').textContent = `About ${Math.round(m.waterLiters * 4)} × 250 ml`;
  $('#metric-target-calories').textContent = `${m.targetCalories.toLocaleString()} kcal`;
  $('#calorie-adjustment-note').textContent = m.calorieNote;

  const macros = [
    ['protein', m.ratios.protein, m.proteinG, 4],
    ['carbs', m.ratios.carbs, m.carbsG, 4],
    ['fats', m.ratios.fats, m.fatsG, 9]
  ];
  for (const [key, ratio, grams, kcalPerGram] of macros) {
    const percent = Math.round(ratio * 100);
    $(`#macro-${key}-pct`).textContent = `${percent}%`;
    $(`#macro-${key}-g`).textContent = `${grams} g`;
    $(`#macro-${key}-kcal`).textContent = `${Math.round(grams * kcalPerGram)} kcal (estimate)`;
    $(`#bar-${key}`).style.width = `${percent}%`;
  }
}

function syncProfileForm() {
  const p = state.profile;
  $('#input-name').value = p.name;
  $('#input-gender').value = p.gender;
  $('#input-age').value = p.age;
  $('#input-height').value = p.height;
  $('#input-weight').value = p.weight;
  $('#input-target-weight').value = p.targetWeight;
  $('#input-goal').value = p.goal;
  $('#input-pace').value = p.pace;
  $('#input-activity').value = p.activity;
  $('#input-diet').value = p.diet;
  $('#input-wake').value = p.wakeTime;
  $('#input-sleep').value = p.sleepTime;
}

function sortedLogs() {
  return [...state.weightLogs].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function appendCell(row, value, className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = value;
  row.appendChild(cell);
  return cell;
}

function renderTracker() {
  const logs = sortedLogs();
  const p = state.profile;
  $('#log-count-badge').textContent = `${logs.length} ${logs.length === 1 ? 'entry' : 'entries'}`;
  $('#track-start-weight').textContent = `${p.weight.toFixed(1)} kg`;
  $('#track-start-date').textContent = 'From your health profile';
  $('#track-remaining').textContent = `${Math.abs(p.targetWeight - p.weight).toFixed(1)} kg`;
  $('#track-goal-badge').textContent = `Target: ${p.targetWeight.toFixed(1)} kg`;

  if (logs.length) {
    const first = logs[0];
    const latest = logs[logs.length - 1];
    const change = latest.weight - first.weight;
    $('#track-current-weight').textContent = `${latest.weight.toFixed(1)} kg`;
    $('#track-latest-date').textContent = formatShortDate(latest.date);
    $('#track-net-change').textContent = `${change > 0 ? '+' : ''}${change.toFixed(1)} kg`;
    $('#track-net-caption').textContent = 'from first to latest';
  } else {
    $('#track-current-weight').textContent = 'None yet';
    $('#track-latest-date').textContent = 'Add your first check-in';
    $('#track-net-change').textContent = '—';
    $('#track-net-caption').textContent = 'Log entries to track change';
  }

  const tbody = $('#weight-history-tbody');
  tbody.replaceChildren();
  if (!logs.length) {
    const row = document.createElement('tr');
    const cell = appendCell(row, 'No check-ins yet. Add your first entry above.', 'empty-cell');
    cell.colSpan = 5;
    tbody.appendChild(row);
  } else {
    [...logs].reverse().forEach((entry, index) => {
      const row = document.createElement('tr');
      appendCell(row, formatShortDate(entry.date));
      appendCell(row, `${entry.weight.toFixed(1)} kg`);
      const newerIndex = logs.length - 1 - index;
      const previous = logs[newerIndex - 1];
      appendCell(row, previous
        ? `${entry.weight - previous.weight > 0 ? '+' : ''}${(entry.weight - previous.weight).toFixed(1)} kg`
        : 'Baseline');
      appendCell(row, entry.note || '—');
      const actionCell = document.createElement('td');
      actionCell.className = 'no-print';
      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'delete-entry';
      removeButton.dataset.deleteLog = entry.id;
      removeButton.textContent = 'Delete';
      actionCell.appendChild(removeButton);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
  }
  drawChart();
}

function drawChart() {
  const canvas = $('#weight-chart');
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * ratio);
  canvas.height = Math.round(bounds.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const width = bounds.width;
  const height = bounds.height;
  const dark = document.documentElement.dataset.theme === 'dark';
  const logs = sortedLogs();
  const target = state.profile.targetWeight;
  const points = logs.length ? logs : [{ date: todayKey(), weight: state.profile.weight }];
  const weights = [...points.map((point) => point.weight), target];
  const padding = Math.max(1.5, (Math.max(...weights) - Math.min(...weights)) * 0.25);
  const low = Math.floor((Math.min(...weights) - padding) * 2) / 2;
  const high = Math.ceil((Math.max(...weights) + padding) * 2) / 2;
  const left = 46, right = 18, top = 18, bottom = 34;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, height - top - bottom);
  const x = (index) => points.length === 1 ? left + plotWidth / 2 : left + index / (points.length - 1) * plotWidth;
  const y = (weight) => top + plotHeight - (weight - low) / (high - low || 1) * plotHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.font = '10px "DM Sans", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let index = 0; index <= 4; index++) {
    const weight = low + (high - low) * index / 4;
    const lineY = y(weight);
    ctx.strokeStyle = dark ? '#304039' : '#e5ece8';
    ctx.beginPath();
    ctx.moveTo(left, lineY);
    ctx.lineTo(width - right, lineY);
    ctx.stroke();
    ctx.fillStyle = dark ? '#a2b0a7' : '#718078';
    ctx.fillText(weight.toFixed(1), left - 7, lineY);
  }

  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = '#d99a32';
  ctx.beginPath();
  ctx.moveTo(left, y(target));
  ctx.lineTo(width - right, y(target));
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = '#07845d';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(x(index), y(point.weight));
    else ctx.lineTo(x(index), y(point.weight));
  });
  ctx.stroke();

  points.forEach((point, index) => {
    ctx.fillStyle = '#07845d';
    ctx.beginPath();
    ctx.arc(x(index), y(point.weight), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dark ? '#a2b0a7' : '#64736c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(formatShortDate(point.date).replace(/, \d{4}$/, ''), x(index), height - 8);
  });
}

function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatTime(totalMinutes) {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function generateSchedule(profile, metrics) {
  let sleepMinutes = timeToMinutes(profile.sleepTime);
  const wakeMinutes = timeToMinutes(profile.wakeTime);
  if (sleepMinutes <= wakeMinutes) sleepMinutes += 1440;
  const awake = sleepMinutes - wakeMinutes;
  const meals = mealTemplates[profile.diet];
  const exercise = profile.goal === 'gain'
    ? ['Strength and mobility', 'A moderate resistance session; adapt intensity to your current ability.']
    : profile.goal === 'loss'
      ? ['Movement break', 'A walk, light cardio or another comfortable activity. Rest days are part of a routine.']
      : ['Activity and recovery', 'Choose enjoyable movement, stretching or a rest break that suits your day.'];

  const items = [
    { id: 'blk_wake', offset: 0, title: 'Wake up and hydrate', detail: 'Start your day at a comfortable pace; drink to thirst.' },
    { id: 'blk_breakfast', mealName: 'Breakfast', offset: 0.08, title: meals.breakfast[0], detail: meals.breakfast[1] },
    { id: 'blk_mid_hydro', offset: 0.25, title: 'Stretch and take a movement break', detail: 'Stand, stretch or take a short walk if comfortable.' },
    { id: 'blk_lunch', mealName: 'Lunch', offset: 0.38, title: meals.lunch[0], detail: meals.lunch[1] },
    { id: 'blk_snack', mealName: 'Snack', offset: 0.58, title: meals.snack[0], detail: meals.snack[1] },
    { id: 'blk_workout', offset: 0.66, title: exercise[0], detail: exercise[1] },
    { id: 'blk_dinner', mealName: 'Dinner', offset: 0.78, title: meals.dinner[0], detail: meals.dinner[1] },
    { id: 'blk_winddown', fixed: sleepMinutes - 60, title: 'Wind down', detail: 'Reduce stimulation and prepare for rest in a way that works for you.' },
    { id: 'blk_sleep', fixed: sleepMinutes, title: 'Sleep', detail: 'Aim for a consistent sleep routine that meets your needs.' }
  ];
  return items.map((item) => ({
    ...item,
    time: formatTime(item.fixed ?? wakeMinutes + Math.round(awake * item.offset)),
    completed: Boolean(state.completedTasks[todayKey()]?.[item.id])
  })).map((item) => ({ ...item, detail: item.id === 'blk_wake' ? `${item.detail} Estimated hydration for the day: ${metrics.waterLiters.toFixed(1)} L.` : item.detail }));
}

function renderSchedule() {
  const p = state.profile;
  const metrics = calculateMetrics(p);
  const blocks = generateSchedule(p, metrics);
  $('#schedule-diet-tag').textContent = dietLabels[p.diet];
  $('#schedule-window-subtitle').textContent = `Your example day runs from ${formatTime(timeToMinutes(p.wakeTime))} to ${formatTime(timeToMinutes(p.sleepTime))}.`;
  const container = $('#schedule-timeline');
  container.replaceChildren();

  let completedCount = 0;
  for (const block of blocks) {
    if (block.completed) completedCount++;
    const item = document.createElement('article');
    item.className = `schedule-item${block.completed ? ' is-done' : ''}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = block.completed;
    checkbox.dataset.taskId = block.id;
    checkbox.setAttribute('aria-label', `Mark ${block.title} complete`);
    const time = document.createElement('span');
    time.className = 'schedule-time';
    time.textContent = block.time;
    const content = document.createElement('div');
    content.className = 'schedule-content';
    const title = document.createElement('strong');
    title.textContent = block.title;
    const detail = document.createElement('p');
    detail.textContent = block.detail;
    content.append(title, detail);
    if (block.mealName) {
      const proof = (state.mealProofs || [])
        .filter((entry) => entry.date === todayKey() && entry.mealName === block.mealName)
        .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
      const mealProof = document.createElement('div');
      mealProof.className = 'meal-proof';
      const label = document.createElement('label');
      label.className = 'meal-photo-label';
      label.textContent = 'Take or choose photo';
      const photoInput = document.createElement('input');
      photoInput.type = 'file';
      photoInput.accept = 'image/jpeg,image/png,image/webp';
      photoInput.setAttribute('capture', 'environment');
      photoInput.className = 'meal-photo-input';
      photoInput.dataset.mealPhoto = '';
      photoInput.dataset.mealName = block.mealName;
      photoInput.setAttribute('aria-label', `Choose a ${block.mealName.toLowerCase()} photo`);
      label.appendChild(photoInput);
      const status = document.createElement('span');
      status.className = 'meal-proof-status';
      status.dataset.mealProofStatus = '';
      status.textContent = proof
        ? mealProofMessage(proof)
        : 'Optional metadata review; it cannot prove photo authenticity.';
      mealProof.append(label, status);
      content.appendChild(mealProof);
    }
    item.append(checkbox, time, content);
    container.appendChild(item);
  }

  const percent = Math.round(completedCount / blocks.length * 100);
  $('#adherence-pct').textContent = `${percent}%`;
  $('#adherence-bar').style.width = `${percent}%`;
  $('#adherence-count').textContent = `${completedCount} of ${blocks.length} blocks completed`;
}

function mealProofMessage(proof) {
  const summary = {
    flagged: 'Flagged metadata marker.',
    review: 'Review suggested; metadata is inconclusive.',
    no_obvious_flags: 'No obvious metadata flags; origin remains unverified.'
  }[proof.status] || 'Photo review unavailable.';
  return [summary, ...proof.flags].join(' ');
}

async function submitMealPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const status = input.closest('.meal-proof').querySelector('[data-meal-proof-status]');
  status.textContent = 'Reviewing image metadata…';

  const formData = new FormData();
  formData.append('mealPhoto', file);
  formData.append('mealName', input.dataset.mealName);
  formData.append('date', todayKey());
  try {
    const result = await api('/api/meals/verify-photo', { method: 'POST', body: formData });
    state.mealProofs = [result.record, ...(state.mealProofs || []).filter((proof) => proof.id !== result.record.id)];
    renderSchedule();
    showToast('Photo metadata review completed. It cannot prove authenticity.');
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message, 'error');
  } finally {
    input.value = '';
  }
}

function renderAll() {
  renderOverview();
  renderTracker();
  renderSchedule();
}

function switchTab(name) {
  state.activeTab = name;
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== `panel-${name}`);
  });
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === name);
  });
  if (name === 'tracker') drawChart();
}

function profileFromForm() {
  return {
    name: $('#input-name').value.trim(),
    gender: $('#input-gender').value,
    age: Number($('#input-age').value),
    height: Number($('#input-height').value),
    weight: Number($('#input-weight').value),
    targetWeight: Number($('#input-target-weight').value),
    goal: $('#input-goal').value,
    pace: Number($('#input-pace').value),
    activity: Number($('#input-activity').value),
    diet: $('#input-diet').value,
    wakeTime: $('#input-wake').value,
    sleepTime: $('#input-sleep').value
  };
}

function csvCell(value) {
  const safe = /^[=+\-@]/.test(String(value)) ? `'${value}` : String(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('vitalcore-theme', next);
    drawChart();
  });

  $('#print-btn').addEventListener('click', () => window.print());

  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(profileFromForm())
      });
      state.profile = result.profile;
      renderAll();
      showToast('Profile saved and estimates updated.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('#weight-log-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const result = await api('/api/weights', {
        method: 'POST',
        body: JSON.stringify({
          date: $('#log-date').value,
          weight: Number($('#log-weight').value),
          note: $('#log-note').value.trim()
        })
      });
      Object.assign(state, result.state);
      $('#log-weight').value = '';
      $('#log-note').value = '';
      $('#input-weight').value = state.profile.weight;
      renderAll();
      showToast('Weight entry saved.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  $('#weight-history-tbody').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-log]');
    if (!button) return;
    try {
      const result = await api(`/api/weights/${encodeURIComponent(button.dataset.deleteLog)}`, { method: 'DELETE' });
      Object.assign(state, result.state);
      $('#input-weight').value = state.profile.weight;
      renderAll();
      showToast('Weight entry removed.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $('#clear-logs-btn').addEventListener('click', async () => {
    if (!window.confirm('Delete all weight check-ins? This cannot be undone.')) return;
    try {
      const result = await api('/api/weights', { method: 'DELETE' });
      Object.assign(state, result.state);
      renderAll();
      showToast('Weight history cleared.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  $('#export-csv-btn').addEventListener('click', () => {
    const rows = [
      ['Date', 'Weight (kg)', 'Target weight (kg)', 'Note'],
      ...sortedLogs().map((entry) => [entry.date, entry.weight.toFixed(1), state.profile.targetWeight.toFixed(1), entry.note || ''])
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vitalcore-weight-history.csv';
    link.click();
    URL.revokeObjectURL(url);
  });

  $('#schedule-timeline').addEventListener('change', async (event) => {
    const photoInput = event.target.closest('[data-meal-photo]');
    if (photoInput) {
      await submitMealPhoto(photoInput);
      return;
    }
    const checkbox = event.target.closest('[data-task-id]');
    if (!checkbox) return;
    checkbox.disabled = true;
    try {
      const result = await api('/api/tasks', {
        method: 'PUT',
        body: JSON.stringify({
          taskId: checkbox.dataset.taskId,
          date: todayKey(),
          completed: checkbox.checked
        })
      });
      state.completedTasks = result.completedTasks;
      renderSchedule();
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      checkbox.disabled = false;
      showToast(error.message, 'error');
    }
  });

  $('#reset-checks-btn').addEventListener('click', async () => {
    try {
      const result = await api(`/api/tasks/${todayKey()}`, { method: 'DELETE' });
      state.completedTasks = result.completedTasks;
      renderSchedule();
      showToast("Today's checklist was reset.");
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  window.addEventListener('resize', () => {
    if (state.activeTab === 'tracker') drawChart();
  });
}

async function initialize() {
  const savedTheme = localStorage.getItem('vitalcore-theme');
  const preferredDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = savedTheme || (preferredDark ? 'dark' : 'light');
  $('#log-date').value = todayKey();
  bindEvents();
  try {
    Object.assign(state, readCachedState());
    const initialState = await api('/api/state');
    Object.assign(state, initialState);
    syncProfileForm();
    renderAll();
  } catch (error) {
    showToast(`Could not load app data: ${error.message}`, 'error');
    document.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  }
}

document.addEventListener('DOMContentLoaded', initialize);
