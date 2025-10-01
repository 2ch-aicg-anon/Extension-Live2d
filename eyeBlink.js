/**
 * Realistic eye blinking system for Live2D characters
 * Simulates natural human eye blinks with individual eye control
 * and customizable timing based on real-world blink patterns
 */

import { extension_settings } from '../../../extensions.js';
import { DEBUG_PREFIX, delay } from './constants.js';

export {
    startEyeBlink,
    stopEyeBlink,
    restartEyeBlink
};

// Хранилище для состояний моргания каждого персонажа
const eyeBlinkStates = {};

// ===============================================================================
// РЕАЛИСТИЧНЫЕ КОНСТАНТЫ МОРГАНИЯ ЧЕЛОВЕКА (БИОЛОГИЧЕСКИ ТОЧНЫЕ v3.0)
// ===============================================================================
// Основаны на научных исследованиях и реальных наблюдениях:
// - Частота: 15-20 морганий в минуту (переменная, зависит от состояния)
// - Длительность: 50-150мс (УСКОРЕНО для естественности, в среднем 100мс)
// - Фазы: закрытие быстрее открытия (асимметрия) + вариативность ±8%
// - Типы: полные (85%), частичные (5%), рефлекторные (двойные 6%, тройные 1%)
// - Рефлексы: первое моргание полное, последующие частичные (35-60%) и быстрее (×1.5)
// - Асинхронность: глаза моргают практически синхронно (≤10 мс)
// - Easing: агрессивные кривые (cubic/quart) имитируют "обрезанный диапазон"

// Интервалы между морганиями (в миллисекундах)
// У реальных людей частота моргания НЕПОСТОЯННА и зависит от "состояния"
const BLINK_INTERVAL_MIN = 2000;  // Минимальный интервал между морганиями (2 сек)
const BLINK_INTERVAL_MAX = 6000;  // Максимальный интервал между морганиями (6 сек) - биологический максимум
const BLINK_INTERVAL_AVERAGE = 4000; // Средний интервал (4 сек = ~15 морганий/мин)

// Вариативность длительности моргания (УСКОРЕНО для естественности)
const BLINK_DURATION_MIN = 50;     // Быстрое моргание (мс)
const BLINK_DURATION_AVERAGE = 100; // Среднее моргание (мс)
const BLINK_DURATION_MAX = 150;    // Медленное моргание (мс)

// Фазы моргания - АСИММЕТРИЧНЫЕ (закрытие быстрее открытия)
const CLOSE_PHASE_RATIO = 0.40;   // 40% времени - закрытие века (быстрее)
const CLOSED_PHASE_RATIO = 0.10;  // 10% времени - веко полностью закрыто
const OPEN_PHASE_RATIO = 0.50;    // 50% времени - открытие века (медленнее)
const PHASE_VARIANCE = 0.08;      // ±8% вариация соотношений фаз для непредсказуемости

// Асинхронность между глазами - БИОЛОГИЧЕСКИ ТОЧНАЯ
const EYE_DESYNC_MIN = 0;       // Минимальная асинхронность
const EYE_DESYNC_MAX = 10;      // Максимальная асинхронность (≤10 мс - как у реальных людей)

// Вероятности различных типов морганий (РЕАЛИСТИЧНЫЕ)
const DOUBLE_BLINK_CHANCE = 0.06;   // 6% - двойное моргание (первое полное, второе частичное)
const TRIPLE_BLINK_CHANCE = 0.01;   // 1% - тройное моргание (первое полное, остальные частичные)
const PARTIAL_BLINK_CHANCE = 0.05;  // 5% - частичное моргание (неполное закрытие)

// Параметры частичного моргания
const PARTIAL_BLINK_MIN = 0.40;     // Минимальное закрытие (40% от полного)
const PARTIAL_BLINK_MAX = 0.75;     // Максимальное закрытие (75% от полного)

// Микродвижения век между морганиями
const EYELID_MICROMOVE_CHANCE = 0.05;  // 5% шанс микродвижения при каждой проверке (было 15%)
const EYELID_MICROMOVE_AMPLITUDE = 0.05; // Амплитуда (5% от диапазона)
const EYELID_MICROMOVE_DURATION = 80;    // Длительность микродвижения (мс)

// Параметры рефлекторных морганий (двойное/тройное)
const REFLEX_BLINK_INTERVAL_MIN = 150;  // Минимум между морганиями в серии
const REFLEX_BLINK_INTERVAL_MAX = 400;  // Максимум между морганиями в серии
const REFLEX_BLINK_CLOSURE_MIN = 0.35;  // Минимальное закрытие второго/третьего моргания (35%)
const REFLEX_BLINK_CLOSURE_MAX = 0.60;  // Максимальное закрытие второго/третьего моргания (60%)
const REFLEX_BLINK_SPEED_MULT = 1.5;    // Множитель скорости для последующих морганий

// ===============================================================================
// ДИНАМИЧЕСКИЕ СОСТОЯНИЯ - для устранения предсказуемости
// ===============================================================================
// У реальных людей частота моргания НЕПОСТОЯННА и меняется в зависимости от:
// - концентрации (реже), расслабленности (чаще), усталости (переменно)
// - эмоционального состояния, влажности глаз и т.д.

// Состояния с разной частотой моргания
const BLINK_STATES = {
    FOCUSED: {      // Концентрация - реже моргает
        name: 'focused',
        intervalMultiplier: 1.4,  // +40% к интервалам
        duration: { min: 8000, max: 25000 }  // 8-25 секунд (УМЕНЬШЕНО для частых смен)
    },
    RELAXED: {      // Расслабленное - нормальная частота
        name: 'relaxed',
        intervalMultiplier: 1.0,  // Базовая частота
        duration: { min: 10000, max: 30000 }  // 10-30 секунд (УМЕНЬШЕНО)
    },
    DISTRACTED: {   // Отвлечённое - чаще моргает
        name: 'distracted',
        intervalMultiplier: 0.7,  // -30% к интервалам
        duration: { min: 6000, max: 20000 }  // 6-20 секунд (УМЕНЬШЕНО)
    },
    TIRED: {        // Усталость - переменная частота
        name: 'tired',
        intervalMultiplier: 0.85, // Чуть чаще
        duration: { min: 7000, max: 22000 }  // 7-22 секунд (УМЕНЬШЕНО)
    },
    HYPER: {        // Гиперактивность - очень часто моргает
        name: 'hyper',
        intervalMultiplier: 0.5,  // -50% к интервалам
        duration: { min: 5000, max: 15000 }  // 5-15 секунд (короткие вспышки)
    },
    DROWSY: {       // Сонливость - очень медленно
        name: 'drowsy',
        intervalMultiplier: 1.6,  // +60% к интервалам
        duration: { min: 8000, max: 20000 }  // 8-20 секунд
    }
};

// Вероятности переходов между состояниями (создают непредсказуемость)
const STATE_WEIGHTS = {
    FOCUSED: 0.15,      // 15% - концентрация
    RELAXED: 0.35,      // 35% - расслабленное (базовое)
    DISTRACTED: 0.20,   // 20% - отвлечённое
    TIRED: 0.12,        // 12% - усталость
    HYPER: 0.10,        // 10% - гиперактивность (частые моргания)
    DROWSY: 0.08        // 8% - сонливость (редкие моргания)
};

// Структура для хранения состояния моргания персонажа
class EyeBlinkState {
    constructor(character) {
        this.character = character;
        this.isRunning = false;
        
        // Параметры для каждого глаза
        this.leftEye = {
            paramId: '',
            minValue: 0,  // Глаз открыт
            maxValue: 1,  // Глаз закрыт
            currentValue: 0,
            isBlinking: false
        };
        
        this.rightEye = {
            paramId: '',
            minValue: 0,  // Глаз открыт
            maxValue: 1,  // Глаз закрыт
            currentValue: 0,
            isBlinking: false
        };
        
        // Динамическое состояние для непредсказуемости
        this.currentState = this.selectRandomState();
        this.nextStateChangeTime = Date.now() + this.getRandomStateDuration(this.currentState);
        
        // Время следующего моргания
        this.nextBlinkTime = Date.now() + this.getRandomInterval();
    }
    
    // Выбирает случайное состояние на основе весов
    selectRandomState() {
        const rand = Math.random();
        let cumulative = 0;
        
        for (const [key, weight] of Object.entries(STATE_WEIGHTS)) {
            cumulative += weight;
            if (rand < cumulative) {
                return BLINK_STATES[key];
            }
        }
        
        return BLINK_STATES.RELAXED; // Fallback
    }
    
    // Возвращает случайную длительность состояния
    getRandomStateDuration(state) {
        const min = state.duration.min;
        const max = state.duration.max;
        return min + Math.random() * (max - min);
    }
    
    // Проверяет и обновляет состояние, если пора
    updateState() {
        const now = Date.now();
        if (now >= this.nextStateChangeTime) {
            const oldState = this.currentState.name;
            this.currentState = this.selectRandomState();
            this.nextStateChangeTime = now + this.getRandomStateDuration(this.currentState);
            
            console.debug(DEBUG_PREFIX, `${this.character}: blink state changed ${oldState} → ${this.currentState.name} (×${this.currentState.intervalMultiplier})`);
        }
    }
    
    // Генерация случайного интервала между морганиями
    // МАКСИМАЛЬНО НЕПРЕДСКАЗУЕМАЯ система - смесь распределений и случайных "выбросов"
    getRandomInterval() {
        // 15% шанс "выброса" - радикально другой интервал для непредсказуемости
        if (Math.random() < 0.15) {
            const outlierType = Math.random();
            
            if (outlierType < 0.4) {
                // 40% выбросов - ОЧЕНЬ БЫСТРОЕ моргание (почти сразу после предыдущего)
                const fastBlink = 800 + Math.random() * 1200; // 0.8-2 секунды
                console.debug(DEBUG_PREFIX, `${this.character}: OUTLIER - fast blink (${Math.round(fastBlink)}ms)`);
                return fastBlink;
            } else if (outlierType < 0.7) {
                // 30% выбросов - ОЧЕНЬ ДОЛГАЯ пауза (концентрация, транс)
                const longPause = 7000 + Math.random() * 5000; // 7-12 секунд
                console.debug(DEBUG_PREFIX, `${this.character}: OUTLIER - long pause (${Math.round(longPause)}ms)`);
                return longPause;
            } else {
                // 30% выбросов - средние "странные" интервалы
                const weirdInterval = 2500 + Math.random() * 2000; // 2.5-4.5 секунды
                return weirdInterval;
            }
        }
        
        // 85% времени - используем смешанное распределение для БОЛЬШОЙ вариативности
        const distributionChoice = Math.random();
        let interval;
        
        if (distributionChoice < 0.4) {
            // 40% - экспоненциальное распределение (много коротких, мало длинных)
            const lambda = 0.3;
            const u = Math.random();
            const exponential = -Math.log(1 - u) / lambda;
            interval = BLINK_INTERVAL_MIN + exponential * 1000;
        } else if (distributionChoice < 0.7) {
            // 30% - равномерное распределение (полная случайность)
            interval = BLINK_INTERVAL_MIN + Math.random() * (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN);
        } else {
            // 30% - нормальное распределение (классическое)
            const u1 = Math.random();
            const u2 = Math.random();
            const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            
            const mean = BLINK_INTERVAL_AVERAGE;
            const stdDev = (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN) / 4; // Увеличили разброс
            
            interval = mean + z * stdDev;
        }
        
        // Применяем модификатор текущего состояния
        if (this.currentState) {
            interval *= this.currentState.intervalMultiplier;
        }
        
        // Добавляем финальный "джиттер" ±15% для устранения паттернов
        const jitter = 0.85 + Math.random() * 0.3; // 0.85-1.15
        interval *= jitter;
        
        // Ограничиваем диапазон (но позволяем выход за пределы на 10%)
        interval = Math.max(BLINK_INTERVAL_MIN * 0.9, Math.min(BLINK_INTERVAL_MAX * 1.1, interval));
        
        return interval;
    }
}

// ===============================================================================
// ФУНКЦИИ ИНТЕРПОЛЯЦИИ С РАЗЛИЧНЫМ EASING
// ===============================================================================

// Закрытие века - очень резкое (имитирует "обрезанную" кривую при расширенном диапазоне)
function easeInCubic(t) {
    return t * t * t;  // Более агрессивное ускорение
}

// Открытие века - с резким стартом и плавным замедлением
function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);  // Более динамичное открытие
}

// Микродвижения - очень мягкое
function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
}

// ===============================================================================
// ГЕНЕРАТОРЫ ВАРИАТИВНОСТИ
// ===============================================================================

// Генерирует случайную длительность моргания с нормальным распределением
function getRandomBlinkDuration() {
    // Box-Muller transform для нормального распределения
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    const mean = BLINK_DURATION_AVERAGE;
    const stdDev = (BLINK_DURATION_MAX - BLINK_DURATION_MIN) / 6;
    
    let duration = mean + z * stdDev;
    duration = Math.max(BLINK_DURATION_MIN, Math.min(BLINK_DURATION_MAX, duration));
    
    return duration;
}

// Определяет тип следующего моргания (полное, частичное, или серия)
function determineBlinkType() {
    const rand = Math.random();
    
    // Тройное моргание (самое редкое)
    if (rand < TRIPLE_BLINK_CHANCE) {
        return { type: 'triple', count: 3 };
    }
    
    // Двойное моргание
    if (rand < TRIPLE_BLINK_CHANCE + DOUBLE_BLINK_CHANCE) {
        return { type: 'double', count: 2 };
    }
    
    // Частичное моргание
    if (rand < TRIPLE_BLINK_CHANCE + DOUBLE_BLINK_CHANCE + PARTIAL_BLINK_CHANCE) {
        const closure = PARTIAL_BLINK_MIN + Math.random() * (PARTIAL_BLINK_MAX - PARTIAL_BLINK_MIN);
        return { type: 'partial', count: 1, closure };
    }
    
    // Обычное полное моргание
    return { type: 'full', count: 1, closure: 1.0 };
}

// Генерирует случайную асинхронность между глазами
function getRandomEyeDesync() {
    // Используем экспоненциальное распределение - чаще маленькие значения, реже большие
    const lambda = 3.0; // Параметр распределения
    const u = Math.random();
    const value = -Math.log(1 - u) / lambda;
    
    // Масштабируем к диапазону 0-EYE_DESYNC_MAX
    const desync = Math.min(value * EYE_DESYNC_MAX / 2, EYE_DESYNC_MAX);
    
    return desync;
}

// Функция для выполнения одного моргания одного глаза
// closureAmount - степень закрытия глаза (0.0 - 1.0), для частичных морганий
// speedMultiplier - множитель скорости (для рефлекторных морганий)
async function performEyeBlink(character, model, eye, settings, closureAmount = 1.0, speedMultiplier = 1.0) {
    if (!eye.paramId || eye.paramId === '') return;
    
    const blinkSpeed = (settings.blinkSpeed || 1.0) * speedMultiplier;
    
    // Генерируем СЛУЧАЙНУЮ длительность для каждого моргания
    const baseDuration = getRandomBlinkDuration();
    const totalDuration = baseDuration / blinkSpeed;
    
    // Добавляем ВАРИАТИВНОСТЬ к фазовым соотношениям (±8%)
    const variance = () => 1 + (Math.random() * 2 - 1) * PHASE_VARIANCE;
    const closeDuration = totalDuration * CLOSE_PHASE_RATIO * variance();
    const closedDuration = totalDuration * CLOSED_PHASE_RATIO * variance();
    const openDuration = totalDuration * OPEN_PHASE_RATIO * variance();
    
    const FRAME_RATE = 60; // 60 FPS
    const frameTime = 1000 / FRAME_RATE;
    
    eye.isBlinking = true;
    
    // Вычисляем целевое значение с учётом частичного закрытия
    const targetClosedValue = eye.minValue + (eye.maxValue - eye.minValue) * closureAmount;
    
    try {
        // ФАЗА 1: Закрытие века (РЕЗКОЕ, использует easeInCubic)
        const closeSteps = Math.ceil(closeDuration / frameTime);
        for (let step = 0; step <= closeSteps; step++) {
            if (!eye.isBlinking) break; // Прервано
            
            const progress = step / closeSteps;
            const eased = easeInCubic(progress); // Резкое закрытие
            
            const value = eye.minValue + (targetClosedValue - eye.minValue) * eased;
            
            try {
                model.internalModel.coreModel.setParameterValueById(eye.paramId, value);
                eye.currentValue = value;
            } catch (error) {
                console.debug(DEBUG_PREFIX, `Error setting eye blink parameter ${eye.paramId}:`, error);
            }
            
            await delay(frameTime);
        }
        
        // ФАЗА 2: Веко закрыто (пауза)
        await delay(closedDuration);
        
        // ФАЗА 3: Открытие века (ДИНАМИЧНОЕ, использует easeOutQuart)
        const openSteps = Math.ceil(openDuration / frameTime);
        for (let step = 0; step <= openSteps; step++) {
            if (!eye.isBlinking) break; // Прервано
            
            const progress = step / openSteps;
            const eased = easeOutQuart(progress); // Динамичное открытие
            
            const value = targetClosedValue + (eye.minValue - targetClosedValue) * eased;
            
            try {
                model.internalModel.coreModel.setParameterValueById(eye.paramId, value);
                eye.currentValue = value;
            } catch (error) {
                console.debug(DEBUG_PREFIX, `Error setting eye blink parameter ${eye.paramId}:`, error);
            }
            
            await delay(frameTime);
        }
        
        // Убедимся, что глаз полностью открыт
        try {
            model.internalModel.coreModel.setParameterValueById(eye.paramId, eye.minValue);
            eye.currentValue = eye.minValue;
        } catch (error) {
            // Игнорируем
        }
        
    } catch (error) {
        console.debug(DEBUG_PREFIX, `Error during eye blink animation:`, error);
    }
    
    eye.isBlinking = false;
}

// Функция для выполнения микродвижения века
async function performEyelidMicromove(character, model, eye) {
    if (!eye.paramId || eye.paramId === '' || eye.isBlinking) return;
    
    const amplitude = EYELID_MICROMOVE_AMPLITUDE * (eye.maxValue - eye.minValue);
    const direction = Math.random() < 0.5 ? 1 : -1;
    const targetValue = eye.minValue + amplitude * direction;
    
    const FRAME_RATE = 60;
    const frameTime = 1000 / FRAME_RATE;
    const steps = Math.ceil(EYELID_MICROMOVE_DURATION / frameTime / 2); // Половина на движение туда, половина обратно
    
    try {
        // Движение к целевому значению
        for (let step = 0; step <= steps; step++) {
            if (eye.isBlinking) return; // Прерываем, если началось моргание
            
            const progress = step / steps;
            const eased = easeInOutSine(progress);
            
            const value = eye.minValue + (targetValue - eye.minValue) * eased;
            
            try {
                model.internalModel.coreModel.setParameterValueById(eye.paramId, value);
            } catch (error) {
                // Игнорируем
            }
            
            await delay(frameTime);
        }
        
        // Возврат к исходному положению
        for (let step = 0; step <= steps; step++) {
            if (eye.isBlinking) return; // Прерываем, если началось моргание
            
            const progress = step / steps;
            const eased = easeInOutSine(progress);
            
            const value = targetValue + (eye.minValue - targetValue) * eased;
            
            try {
                model.internalModel.coreModel.setParameterValueById(eye.paramId, value);
            } catch (error) {
                // Игнорируем
            }
            
            await delay(frameTime);
        }
        
    } catch (error) {
        // Игнорируем ошибки микродвижений
    }
}

// Функция для выполнения моргания обоих глаз
// Поддерживает различные типы: полное, частичное, двойное, тройное
async function performBothEyesBlink(character, model, state, settings, blinkType, speedMultiplier = 1.0) {
    const closureAmount = blinkType.closure || 1.0;
    
    // Генерируем биологически точную асинхронность между глазами (≤10 мс)
    const desync = getRandomEyeDesync();
    
    // Запускаем моргание левого глаза
    if (state.leftEye.paramId && state.leftEye.paramId !== '') {
        performEyeBlink(character, model, state.leftEye, settings, closureAmount, speedMultiplier);
    }
    
    // Задержка перед морганием правого глаза
    if (desync > 0) {
        await delay(desync);
    }
    
    // Запускаем моргание правого глаза
    if (state.rightEye.paramId && state.rightEye.paramId !== '') {
        performEyeBlink(character, model, state.rightEye, settings, closureAmount, speedMultiplier);
    }
}

// Функция для выполнения серии морганий (двойное/тройное - рефлекторное)
// Первое моргание ПОЛНОЕ, последующие - ЧАСТИЧНЫЕ и БЫСТРЫЕ (как у реальных людей)
async function performBlinkSeries(character, model, state, settings, count) {
    for (let i = 0; i < count; i++) {
        let blinkType, speedMult;
        
        if (i === 0) {
            // Первое моргание - полное и нормальной скорости
            blinkType = { type: 'full', closure: 1.0 };
            speedMult = 1.0;
        } else {
            // Последующие моргания - частичные и быстрые
            const closure = REFLEX_BLINK_CLOSURE_MIN + 
                          Math.random() * (REFLEX_BLINK_CLOSURE_MAX - REFLEX_BLINK_CLOSURE_MIN);
            blinkType = { type: 'reflex_partial', closure };
            speedMult = REFLEX_BLINK_SPEED_MULT;
        }
        
        await performBothEyesBlink(character, model, state, settings, blinkType, speedMult);
        
        // Интервал между морганиями в серии (кроме последнего)
        if (i < count - 1) {
            const interval = REFLEX_BLINK_INTERVAL_MIN + 
                           Math.random() * (REFLEX_BLINK_INTERVAL_MAX - REFLEX_BLINK_INTERVAL_MIN);
            await delay(interval);
        }
    }
}

// Функция для выполнения микродвижений обоих век
async function performBothEyelidsMicromove(character, model, state) {
    // Независимые микродвижения для каждого глаза
    const leftDelay = Math.random() * 50; // Небольшая асинхронность
    
    if (state.leftEye.paramId && state.leftEye.paramId !== '') {
        performEyelidMicromove(character, model, state.leftEye);
    }
    
    if (leftDelay > 0) {
        await delay(leftDelay);
    }
    
    if (state.rightEye.paramId && state.rightEye.paramId !== '') {
        performEyelidMicromove(character, model, state.rightEye);
    }
}

// Основной цикл моргания
async function eyeBlinkLoop(character, model, model_path) {
    const state = eyeBlinkStates[character];
    if (!state) return;
    
    state.isRunning = true;
    console.debug(DEBUG_PREFIX, `Starting eye blink system for ${character}`);
    
    // Получаем настройки персонажа для конкретной модели
    const characterSettings = extension_settings.live2d.characterModelsSettings[character]?.[model_path];
    if (!characterSettings?.eye_blink_params) {
        console.debug(DEBUG_PREFIX, `No eye blink params found for ${character}`);
        state.isRunning = false;
        return;
    }
    
    // Загружаем параметры глаз из настроек персонажа
    const blinkParams = characterSettings.eye_blink_params;
    
    state.leftEye.paramId = blinkParams.left_eye?.paramId || '';
    state.leftEye.minValue = blinkParams.left_eye?.minValue ?? 0;
    state.leftEye.maxValue = blinkParams.left_eye?.maxValue ?? 1;
    
    state.rightEye.paramId = blinkParams.right_eye?.paramId || '';
    state.rightEye.minValue = blinkParams.right_eye?.minValue ?? 0;
    state.rightEye.maxValue = blinkParams.right_eye?.maxValue ?? 1;
    
    // Проверяем, что хотя бы один глаз настроен
    if (!state.leftEye.paramId && !state.rightEye.paramId) {
        console.debug(DEBUG_PREFIX, `No eye parameters configured for ${character}`);
        state.isRunning = false;
        return;
    }
    
    // Получаем глобальные настройки моргания
    const settings = {
        enabled: extension_settings.live2d.eyeBlinkEnabled ?? true,
        blinkSpeed: extension_settings.live2d.eyeBlinkSpeed ?? 1.0,
        blinkIntervalMin: extension_settings.live2d.eyeBlinkIntervalMin ?? BLINK_INTERVAL_MIN,
        blinkIntervalMax: extension_settings.live2d.eyeBlinkIntervalMax ?? BLINK_INTERVAL_MAX
    };
    
    console.debug(DEBUG_PREFIX, `Eye blink started for ${character}`);
    
    // Основной цикл
    while (state.isRunning) {
        // Проверяем, что модель всё ещё существует
        if (!model?.internalModel?.coreModel) {
            console.debug(DEBUG_PREFIX, `Model destroyed, stopping eye blink for ${character}`);
            break;
        }
        
        // Проверяем, включена ли система моргания
        if (!extension_settings.live2d.eyeBlinkEnabled) {
            await delay(1000);
            continue;
        }
        
        // Обновляем состояние (для непредсказуемости частоты)
        state.updateState();
        
        const now = Date.now();
        
        // Проверяем, пора ли моргнуть
        if (now >= state.nextBlinkTime) {
            // Определяем ТИП следующего моргания
            const blinkType = determineBlinkType();
            
            // Выполняем моргание в зависимости от типа
            if (blinkType.count > 1) {
                // Двойное или тройное моргание (рефлекторное)
                console.debug(DEBUG_PREFIX, `${character}: ${blinkType.type} blink (${blinkType.count}x) [${state.currentState.name}]`);
                await performBlinkSeries(character, model, state, settings, blinkType.count);
            } else if (blinkType.type === 'partial') {
                // Частичное моргание
                console.debug(DEBUG_PREFIX, `${character}: partial blink (${Math.round(blinkType.closure * 100)}%) [${state.currentState.name}]`);
                await performBothEyesBlink(character, model, state, settings, blinkType);
            } else {
                // Обычное полное моргание
                await performBothEyesBlink(character, model, state, settings, blinkType);
            }
            
            // Планируем следующее моргание (с учётом текущего состояния)
            state.nextBlinkTime = now + state.getRandomInterval();
        } else {
            // Между морганиями - случайные микродвижения век
            if (Math.random() < EYELID_MICROMOVE_CHANCE) {
                performBothEyelidsMicromove(character, model, state);
            }
        }
        
        // Задержка перед следующей проверкой (уменьшена для точности)
        await delay(50);
    }
    
    state.isRunning = false;
    console.debug(DEBUG_PREFIX, `Eye blink system stopped for ${character}`);
}

// ===============================================================================
// ЭКСПОРТИРУЕМЫЕ ФУНКЦИИ
// ===============================================================================

async function startEyeBlink(character, model, model_path) {
    // Создаём состояние, если его нет
    if (!eyeBlinkStates[character]) {
        eyeBlinkStates[character] = new EyeBlinkState(character);
    }
    
    const state = eyeBlinkStates[character];
    
    // Если уже запущено, не запускаем повторно
    if (state.isRunning) {
        console.debug(DEBUG_PREFIX, `Eye blink already running for ${character}`);
        return;
    }
    
    // Запускаем основной цикл
    eyeBlinkLoop(character, model, model_path);
}

async function stopEyeBlink(character) {
    const state = eyeBlinkStates[character];
    if (state) {
        state.isRunning = false;
        state.leftEye.isBlinking = false;
        state.rightEye.isBlinking = false;
        console.debug(DEBUG_PREFIX, `Stopping eye blink for ${character}`);
        
        // Ждём немного, чтобы цикл завершился
        await delay(200);
    }
}

async function restartEyeBlink(character, model, model_path) {
    await stopEyeBlink(character);
    await startEyeBlink(character, model, model_path);
}
