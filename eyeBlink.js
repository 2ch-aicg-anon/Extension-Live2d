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
// - Длительность: 100-400мс (в среднем 100-150мс)
// - Фазы: закрытие 60% времени, открытие 40% времени
// - Асимметрия: глаза моргают практически синхронно, но с небольшой вариацией

// Интервалы между морганиями (в миллисекундах)
const BLINK_INTERVAL_MIN = 2000;  // Минимальный интервал между морганиями (2 сек)
const BLINK_INTERVAL_MAX = 6000;  // Максимальный интервал между морганиями (6 сек)
const BLINK_INTERVAL_AVERAGE = 3500; // Средний интервал (3.5 сек = ~17 морганий/мин)

// Длительность одного моргания (управляется настройкой blinkSpeed)
// Базовая длительность для нормальной скорости (1.0x)
const BLINK_DURATION_BASE = 150; // мс (реалистичная скорость)

// Фазы моргания (пропорции от общей длительности)
const CLOSE_PHASE_RATIO = 0.45;   // 45% времени - закрытие века
const CLOSED_PHASE_RATIO = 0.10;  // 10% времени - веко полностью закрыто
const OPEN_PHASE_RATIO = 0.45;    // 45% времени - открытие века

// Небольшая задержка между морганиями левого и правого глаза для естественности (мс)
const EYE_DESYNC_MAX = 20; // Максимальная асинхронность между глазами

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

// Функция интерполяции с easing
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Функция для выполнения одного моргания одного глаза
async function performEyeBlink(character, model, eye, settings) {
    if (!eye.paramId || eye.paramId === '') return;
    
    const blinkSpeed = settings.blinkSpeed || 1.0;
    const totalDuration = BLINK_DURATION_BASE / blinkSpeed;
    
    // Вычисляем длительности фаз
    const closeDuration = totalDuration * CLOSE_PHASE_RATIO;
    const closedDuration = totalDuration * CLOSED_PHASE_RATIO;
    const openDuration = totalDuration * OPEN_PHASE_RATIO;
    
    const FRAME_RATE = 60; // 60 FPS
    const frameTime = 1000 / FRAME_RATE;
    
    eye.isBlinking = true;
    
    console.debug(DEBUG_PREFIX, `Blinking ${eye.paramId}: minValue=${eye.minValue}, maxValue=${eye.maxValue}`);
    
    try {
        // ФАЗА 1: Закрытие века (плавное движение от открытого к закрытому)
        const closeSteps = Math.ceil(closeDuration / frameTime);
        for (let step = 0; step <= closeSteps; step++) {
            if (!eye.isBlinking) break; // Прервано
            
            const progress = step / closeSteps;
            const eased = easeInOutCubic(progress);
            
            // Интерполяция от minValue (открыт) к maxValue (закрыт)
            const value = eye.minValue + (eye.maxValue - eye.minValue) * eased;
            
            // Логирование первого и последнего значения
            if (step === 0 || step === closeSteps) {
                console.debug(DEBUG_PREFIX, `${eye.paramId} close phase: step=${step}/${closeSteps}, value=${value.toFixed(3)}`);
            }
            
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
        
        // ФАЗА 3: Открытие века (более быстрое движение от закрытого к открытому)
        const openSteps = Math.ceil(openDuration / frameTime);
        for (let step = 0; step <= openSteps; step++) {
            if (!eye.isBlinking) break; // Прервано
            
            const progress = step / openSteps;
            const eased = easeInOutCubic(progress);
            
            // Интерполяция от maxValue (закрыт) к minValue (открыт)
            const value = eye.maxValue + (eye.minValue - eye.maxValue) * eased;
            
            // Логирование первого и последнего значения
            if (step === 0 || step === openSteps) {
                console.debug(DEBUG_PREFIX, `${eye.paramId} open phase: step=${step}/${openSteps}, value=${value.toFixed(3)}`);
            }
            
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

// Функция для выполнения моргания обоих глаз
async function performBothEyesBlink(character, model, state, settings) {
    // Добавляем небольшую асинхронность между глазами для естественности
    const desync = Math.random() * EYE_DESYNC_MAX;
    
    // Запускаем моргание левого глаза
    if (state.leftEye.paramId && state.leftEye.paramId !== '') {
        performEyeBlink(character, model, state.leftEye, settings);
    }
    
    // Небольшая задержка перед морганием правого глаза
    if (desync > 0) {
        await delay(desync);
    }
    
    // Запускаем моргание правого глаза
    if (state.rightEye.paramId && state.rightEye.paramId !== '') {
        performEyeBlink(character, model, state.rightEye, settings);
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
    state.leftEye.minValue = blinkParams.left_eye?.minValue || 0;
    state.leftEye.maxValue = blinkParams.left_eye?.maxValue || 1;
    
    state.rightEye.paramId = blinkParams.right_eye?.paramId || '';
    state.rightEye.minValue = blinkParams.right_eye?.minValue || 0;
    state.rightEye.maxValue = blinkParams.right_eye?.maxValue || 1;
    
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
    
    console.debug(DEBUG_PREFIX, `Eye blink settings for ${character}:`, settings);
    console.debug(DEBUG_PREFIX, `Left eye: ${state.leftEye.paramId} (${state.leftEye.minValue} to ${state.leftEye.maxValue})`);
    console.debug(DEBUG_PREFIX, `Right eye: ${state.rightEye.paramId} (${state.rightEye.minValue} to ${state.rightEye.maxValue})`);
    
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
            // Выполняем моргание
            await performBothEyesBlink(character, model, state, settings);
            
            // Планируем следующее моргание
            state.nextBlinkTime = now + state.getRandomInterval();
            
            console.debug(DEBUG_PREFIX, `${character} blinked, next blink in ${Math.round((state.nextBlinkTime - now) / 1000)}s`);
        }
        
        // Небольшая задержка перед следующей проверкой
        await delay(100);
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
