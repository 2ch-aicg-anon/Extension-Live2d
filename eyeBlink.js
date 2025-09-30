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
// РЕАЛИСТИЧНЫЕ КОНСТАНТЫ МОРГАНИЯ ЧЕЛОВЕКА
// ===============================================================================
// Основаны на научных исследованиях моргания человека:
// - Частота: 15-20 морганий в минуту (каждые 3-4 секунды)
// - Длительность: 100-400мс (в среднем 150мс с вариациями)
// - Фазы: закрытие быстрее открытия (асимметрия)
// - Типы: полные, частичные, рефлекторные (двойные/тройные)
// - Асимметрия: глаза моргают с вариацией 0-80мс

// Интервалы между морганиями (в миллисекундах)
const BLINK_INTERVAL_MIN = 2000;  // Минимальный интервал между морганиями (2 сек)
const BLINK_INTERVAL_MAX = 6000;  // Максимальный интервал между морганиями (6 сек)
const BLINK_INTERVAL_AVERAGE = 3500; // Средний интервал (3.5 сек = ~17 морганий/мин)

// Вариативность длительности моргания
const BLINK_DURATION_MIN = 100;    // Быстрое моргание (мс)
const BLINK_DURATION_AVERAGE = 150; // Среднее моргание (мс)
const BLINK_DURATION_MAX = 400;    // Медленное моргание (мс)

// Фазы моргания - АСИММЕТРИЧНЫЕ (закрытие быстрее открытия)
const CLOSE_PHASE_RATIO = 0.40;   // 40% времени - закрытие века (быстрее)
const CLOSED_PHASE_RATIO = 0.10;  // 10% времени - веко полностью закрыто
const OPEN_PHASE_RATIO = 0.50;    // 50% времени - открытие века (медленнее)

// Асинхронность между глазами - УВЕЛИЧЕНА для большей естественности
const EYE_DESYNC_MIN = 0;       // Минимальная асинхронность
const EYE_DESYNC_MAX = 80;      // Максимальная асинхронность (более выражена)

// Вероятности различных типов морганий
const DOUBLE_BLINK_CHANCE = 0.08;   // 8% - двойное моргание
const TRIPLE_BLINK_CHANCE = 0.02;   // 2% - тройное моргание (рефлекторное)
const PARTIAL_BLINK_CHANCE = 0.12;  // 12% - частичное моргание (неполное закрытие)

// Параметры частичного моргания
const PARTIAL_BLINK_MIN = 0.40;     // Минимальное закрытие (40% от полного)
const PARTIAL_BLINK_MAX = 0.75;     // Максимальное закрытие (75% от полного)

// Микродвижения век между морганиями
const EYELID_MICROMOVE_CHANCE = 0.15;  // 15% шанс микродвижения при каждой проверке
const EYELID_MICROMOVE_AMPLITUDE = 0.05; // Амплитуда (5% от диапазона)
const EYELID_MICROMOVE_DURATION = 80;    // Длительность микродвижения (мс)

// Интервал между морганиями в серии (для двойных/тройных морганий)
const REFLEX_BLINK_INTERVAL_MIN = 150;  // Минимум между морганиями в серии
const REFLEX_BLINK_INTERVAL_MAX = 400;  // Максимум между морганиями в серии

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
        
        // Время следующего моргания
        this.nextBlinkTime = Date.now() + this.getRandomInterval();
    }
    
    // Генерация случайного интервала между морганиями
    // Использует нормальное распределение вокруг среднего значения
    getRandomInterval() {
        // Используем Box-Muller transform для нормального распределения
        const u1 = Math.random();
        const u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        
        // Масштабируем к нужному диапазону
        const mean = BLINK_INTERVAL_AVERAGE;
        const stdDev = (BLINK_INTERVAL_MAX - BLINK_INTERVAL_MIN) / 6; // ~95% в пределах min-max
        
        let interval = mean + z * stdDev;
        
        // Ограничиваем диапазон
        interval = Math.max(BLINK_INTERVAL_MIN, Math.min(BLINK_INTERVAL_MAX, interval));
        
        return interval;
    }
}

// ===============================================================================
// ФУНКЦИИ ИНТЕРПОЛЯЦИИ С РАЗЛИЧНЫМ EASING
// ===============================================================================

// Закрытие века - более резкое (быстрый старт, быстрое ускорение)
function easeInQuad(t) {
    return t * t;
}

// Открытие века - более плавное (медленное замедление в конце)
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
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
async function performEyeBlink(character, model, eye, settings, closureAmount = 1.0) {
    if (!eye.paramId || eye.paramId === '') return;
    
    const blinkSpeed = settings.blinkSpeed || 1.0;
    
    // Генерируем СЛУЧАЙНУЮ длительность для каждого моргания
    const baseDuration = getRandomBlinkDuration();
    const totalDuration = baseDuration / blinkSpeed;
    
    // Вычисляем длительности фаз (АСИММЕТРИЧНЫЕ - закрытие быстрее открытия)
    const closeDuration = totalDuration * CLOSE_PHASE_RATIO;
    const closedDuration = totalDuration * CLOSED_PHASE_RATIO;
    const openDuration = totalDuration * OPEN_PHASE_RATIO;
    
    const FRAME_RATE = 60; // 60 FPS
    const frameTime = 1000 / FRAME_RATE;
    
    eye.isBlinking = true;
    
    // Вычисляем целевое значение с учётом частичного закрытия
    const targetClosedValue = eye.minValue + (eye.maxValue - eye.minValue) * closureAmount;
    
    try {
        // ФАЗА 1: Закрытие века (БЫСТРОЕ, использует easeInQuad)
        const closeSteps = Math.ceil(closeDuration / frameTime);
        for (let step = 0; step <= closeSteps; step++) {
            if (!eye.isBlinking) break; // Прервано
            
            const progress = step / closeSteps;
            const eased = easeInQuad(progress); // Быстрое закрытие
            
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
        
        // ФАЗА 3: Открытие века (МЕДЛЕННОЕ, использует easeOutCubic)
        const openSteps = Math.ceil(openDuration / frameTime);
        for (let step = 0; step <= openSteps; step++) {
            if (!eye.isBlinking) break; // Прервано
            
            const progress = step / openSteps;
            const eased = easeOutCubic(progress); // Плавное открытие
            
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
async function performBothEyesBlink(character, model, state, settings, blinkType) {
    const closureAmount = blinkType.closure || 1.0;
    
    // Генерируем УЛУЧШЕННУЮ асинхронность между глазами
    const desync = getRandomEyeDesync();
    
    // Запускаем моргание левого глаза
    if (state.leftEye.paramId && state.leftEye.paramId !== '') {
        performEyeBlink(character, model, state.leftEye, settings, closureAmount);
    }
    
    // Задержка перед морганием правого глаза
    if (desync > 0) {
        await delay(desync);
    }
    
    // Запускаем моргание правого глаза
    if (state.rightEye.paramId && state.rightEye.paramId !== '') {
        performEyeBlink(character, model, state.rightEye, settings, closureAmount);
    }
}

// Функция для выполнения серии морганий (двойное/тройное - рефлекторное)
async function performBlinkSeries(character, model, state, settings, count) {
    for (let i = 0; i < count; i++) {
        // Определяем тип для каждого моргания в серии
        // В серии все моргания полные (не частичные)
        const blinkType = { type: 'full', closure: 1.0 };
        
        await performBothEyesBlink(character, model, state, settings, blinkType);
        
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
        
        const now = Date.now();
        
        // Проверяем, пора ли моргнуть
        if (now >= state.nextBlinkTime) {
            // Определяем ТИП следующего моргания
            const blinkType = determineBlinkType();
            
            // Выполняем моргание в зависимости от типа
            if (blinkType.count > 1) {
                // Двойное или тройное моргание (рефлекторное)
                console.debug(DEBUG_PREFIX, `${character}: ${blinkType.type} blink (${blinkType.count}x)`);
                await performBlinkSeries(character, model, state, settings, blinkType.count);
            } else if (blinkType.type === 'partial') {
                // Частичное моргание
                console.debug(DEBUG_PREFIX, `${character}: partial blink (${Math.round(blinkType.closure * 100)}%)`);
                await performBothEyesBlink(character, model, state, settings, blinkType);
            } else {
                // Обычное полное моргание
                await performBothEyesBlink(character, model, state, settings, blinkType);
            }
            
            // Планируем следующее моргание
            state.nextBlinkTime = now + state.getRandomInterval();
        } else {
            // Между морганиями - случайные микродвижения век
            if (Math.random() < EYELID_MICROMOVE_CHANCE) {
                performBothEyelidsMicromove(character, model, state);
            }
        }
        
        // Задержка перед следующей проверкой (увеличена для микродвижений)
        await delay(200);
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
