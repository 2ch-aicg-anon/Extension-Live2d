/**
 * Advanced body movement system for Live2D characters
 * Creates natural, lifelike body movements with multiple noise layers,
 * physics simulation, and state-based behavior
 */

import { extension_settings } from '../../../extensions.js';
import { DEBUG_PREFIX, delay } from './constants.js';

export {
    startBodyMovement,
    stopBodyMovement,
    restartBodyMovement,
    cleanupBodyMovement
};

// Хранилище для состояний движения каждого персонажа
const bodyMovementStates = {};

// Константы системы
const IDLE_THRESHOLD_MS = 500; // Время без движения рта для перехода в idle
const UPDATE_INTERVAL_MS = 50; // Базовый интервал обновления (20 FPS)
const MICRO_UPDATE_INTERVAL_MS = 100; // Интервал для микродвижений (10 FPS)

// Структура для хранения состояния движения персонажа
class BodyMovementState {
    constructor(character) {
        this.character = character;
        this.isRunning = false;
        this.currentState = 'idle'; // 'idle' или 'talking'
        this.lastMouthActivity = Date.now();
        
        // Текущие значения параметров
        this.currentValues = {
            param1: 0,
            param2: 0,
            param3: 0
        };
        
        // Целевые значения для плавной интерполяции
        this.targetValues = {
            param1: 0,
            param2: 0,
            param3: 0
        };
        
        // Скорости изменения (для инерции)
        this.velocities = {
            param1: 0,
            param2: 0,
            param3: 0
        };
        
        // Многослойный шум (медленный, средний, быстрый)
        this.noisePhases = {
            slow: { param1: 0, param2: 0, param3: 0 },
            medium: { param1: 0, param2: 0, param3: 0 },
            fast: { param1: 0, param2: 0, param3: 0 }
        };
        
        // Импульсы
        this.impulses = {
            param1: { active: false, value: 0, decay: 0 },
            param2: { active: false, value: 0, decay: 0 },
            param3: { active: false, value: 0, decay: 0 }
        };
        
        // Время последнего импульса для каждого параметра
        this.lastImpulseTime = {
            param1: 0,
            param2: 0,
            param3: 0
        };
    }
}

// Функция для генерации Перлин-подобного шума
function smoothNoise(phase, frequency, amplitude) {
    // Используем комбинацию синусоид для создания плавного псевдослучайного шума
    const noise1 = Math.sin(phase * frequency) * 0.5;
    const noise2 = Math.sin(phase * frequency * 2.1 + 1.2) * 0.3;
    const noise3 = Math.sin(phase * frequency * 3.7 + 2.5) * 0.2;
    return (noise1 + noise2 + noise3) * amplitude;
}

// Функция для генерации импульса
function generateImpulse(state, paramKey) {
    const now = Date.now();
    const timeSinceLastImpulse = now - state.lastImpulseTime[paramKey];
    
    // Получаем настройку частоты импульсов из UI
    const impulseFrequency = extension_settings.live2d.bodyMovementImpulseChance || 2;
    const baseChance = impulseFrequency / 100; // Преобразуем проценты в вероятность
    
    // Настройки импульсов в зависимости от состояния
    const impulseConfig = state.currentState === 'talking' ? {
        chance: baseChance, // Базовый шанс для talking
        minInterval: 1000, // Минимум 1 секунда между импульсами
        amplitudeMin: 0.3,
        amplitudeMax: 0.8,
        decayRate: 0.92 // Быстрое затухание
    } : {
        chance: baseChance * 0.25, // В idle импульсы реже
        minInterval: 3000, // Минимум 3 секунды между импульсами
        amplitudeMin: 0.1,
        amplitudeMax: 0.3,
        decayRate: 0.95 // Медленное затухание
    };
    
    // Проверяем, можем ли генерировать новый импульс
    if (timeSinceLastImpulse > impulseConfig.minInterval && Math.random() < impulseConfig.chance) {
        const amplitude = impulseConfig.amplitudeMin + Math.random() * (impulseConfig.amplitudeMax - impulseConfig.amplitudeMin);
        const direction = Math.random() > 0.5 ? 1 : -1;
        
        state.impulses[paramKey] = {
            active: true,
            value: amplitude * direction,
            decay: impulseConfig.decayRate
        };
        state.lastImpulseTime[paramKey] = now;
    }
}

// Функция для обновления импульса
function updateImpulse(impulse) {
    if (impulse.active) {
        impulse.value *= impulse.decay;
        if (Math.abs(impulse.value) < 0.01) {
            impulse.active = false;
            impulse.value = 0;
        }
    }
}

// Функция для расчёта корреляции между параметрами
function calculateCorrelation(baseValue, correlationFactor) {
    // Добавляем небольшую задержку и искажение для более естественного движения
    const delay = Math.sin(Date.now() * 0.0001) * 0.2;
    return baseValue * correlationFactor * (1 + delay);
}

// Основная функция обновления движений тела
async function updateBodyMovement(character, model, settings) {
    const state = bodyMovementStates[character];
    if (!state || !state.isRunning) return;
    
    // Проверяем, включена ли система движения тела
    if (!extension_settings.live2d.bodyMovementEnabled) return;
    
    const time = Date.now() / 1000;
    
    // Получаем настройки интенсивности из UI
    const idleIntensity = extension_settings.live2d.bodyMovementIdleIntensity || 0.3;
    const talkingIntensity = extension_settings.live2d.bodyMovementTalkingIntensity || 0.6;
    const smoothness = extension_settings.live2d.bodyMovementSmoothness || 0.85;
    
    // Определяем веса для разных состояний
    const intensity = state.currentState === 'talking' ? talkingIntensity : idleIntensity;
    
    const stateWeights = state.currentState === 'talking' ? {
        slowNoise: 0.3 * intensity,
        mediumNoise: 0.5 * intensity,
        fastNoise: 0.2 * intensity,
        impulse: 1.0,
        damping: smoothness, // Используем настройку плавности
        springStiffness: 0.15 * (2 - smoothness) // Чем плавнее, тем меньше жёсткость
    } : {
        slowNoise: 0.6 * intensity,
        mediumNoise: 0.3 * intensity,
        fastNoise: 0.1 * intensity,
        impulse: 0.5,
        damping: 0.85 + (smoothness - 0.85) * 0.5, // Для idle более плавное
        springStiffness: 0.08 * (2 - smoothness)
    };
    
    // Обновляем фазы шумов
    state.noisePhases.slow.param1 += 0.01;
    state.noisePhases.slow.param2 += 0.011;
    state.noisePhases.slow.param3 += 0.009;
    
    state.noisePhases.medium.param1 += 0.05;
    state.noisePhases.medium.param2 += 0.048;
    state.noisePhases.medium.param3 += 0.052;
    
    state.noisePhases.fast.param1 += 0.2;
    state.noisePhases.fast.param2 += 0.18;
    state.noisePhases.fast.param3 += 0.22;
    
    // Обрабатываем каждый параметр
    const params = ['param1', 'param2', 'param3'];
    
    // БАГ 5 FIX: Сохраняем текущие значения для корреляции (используем уже примененные значения)
    const previousCurrentValues = {
        param1: state.currentValues.param1,
        param2: state.currentValues.param2,
        param3: state.currentValues.param3
    };
    
    for (let i = 0; i < params.length; i++) {
        const paramKey = params[i];
        const paramSettings = settings.mouth_linked_params[paramKey];
        
        if (!paramSettings.paramId || paramSettings.paramId === '') continue;
        
        // Генерируем импульсы
        generateImpulse(state, paramKey);
        updateImpulse(state.impulses[paramKey]);
        
        // Рассчитываем многослойный шум
        const slowNoise = smoothNoise(state.noisePhases.slow[paramKey], 1, 1) * stateWeights.slowNoise;
        const mediumNoise = smoothNoise(state.noisePhases.medium[paramKey], 1, 0.5) * stateWeights.mediumNoise;
        const fastNoise = smoothNoise(state.noisePhases.fast[paramKey], 1, 0.2) * stateWeights.fastNoise;
        
        // Комбинируем все компоненты движения
        let targetValue = slowNoise + mediumNoise + fastNoise;
        
        // Добавляем импульс
        if (state.impulses[paramKey].active) {
            targetValue += state.impulses[paramKey].value * stateWeights.impulse;
        }
        
        // БАГ 5 FIX: Используем сохраненные значения для корреляции (синхронизировано)
        if (i === 1) { // param2 коррелирует с param1
            targetValue += calculateCorrelation(previousCurrentValues.param1, 0.3);
        } else if (i === 2) { // param3 коррелирует с обоими
            targetValue += calculateCorrelation(previousCurrentValues.param1, 0.2);
            targetValue += calculateCorrelation(previousCurrentValues.param2, -0.15);
        }
        
        // Ограничиваем целевое значение
        targetValue = Math.max(-1, Math.min(1, targetValue));
        state.targetValues[paramKey] = targetValue;
        
        // Физическая симуляция (пружина + демпфер)
        const springForce = (state.targetValues[paramKey] - state.currentValues[paramKey]) * stateWeights.springStiffness;
        state.velocities[paramKey] = state.velocities[paramKey] * stateWeights.damping + springForce;
        state.currentValues[paramKey] += state.velocities[paramKey];
        
        // Преобразуем в диапазон параметра
        const normalizedValue = (state.currentValues[paramKey] + 1) / 2; // От (-1,1) к (0,1)
        const finalValue = paramSettings.minValue + normalizedValue * (paramSettings.maxValue - paramSettings.minValue);
        
        // БАГ 8 FIX: Безопасная проверка и применение параметра
        try {
            if (model?.internalModel?.coreModel) {
                model.internalModel.coreModel.setParameterValueById(paramSettings.paramId, finalValue);
            } else {
                // Модель уничтожена во время выполнения - прерываем обновление
                console.debug(DEBUG_PREFIX, `Model destroyed during update for ${character}`);
                state.isRunning = false;
                return;
            }
        } catch (error) {
            console.debug(DEBUG_PREFIX, `Error setting body parameter ${paramSettings.paramId}:`, error);
        }
    }
}

// Функция для определения состояния (idle/talking)
function updateMovementState(character, isMouthMoving) {
    const state = bodyMovementStates[character];
    if (!state) return;
    
    const now = Date.now();
    
    if (isMouthMoving) {
        state.lastMouthActivity = now;
        if (state.currentState !== 'talking') {
            state.currentState = 'talking';
            console.debug(DEBUG_PREFIX, `${character} switched to talking state`);
        }
    } else {
        const timeSinceLastActivity = now - state.lastMouthActivity;
        if (timeSinceLastActivity > IDLE_THRESHOLD_MS && state.currentState !== 'idle') {
            state.currentState = 'idle';
            console.debug(DEBUG_PREFIX, `${character} switched to idle state`);
        }
    }
}

// Основной цикл движения тела
async function bodyMovementLoop(character, model, model_path) {
    const state = bodyMovementStates[character];
    if (!state) return;
    
    state.isRunning = true;
    console.debug(DEBUG_PREFIX, `Starting body movement for ${character}`);
    
    // Получаем настройки персонажа
    const settings = extension_settings.live2d.characterModelsSettings[character]?.[model_path];
    if (!settings?.mouth_linked_params) {
        console.debug(DEBUG_PREFIX, `No mouth linked params found for ${character}`);
        state.isRunning = false;
        return;
    }
    
    // Основной цикл
    while (state.isRunning) {
        // БАГ 8 FIX: Проверяем, что модель всё ещё существует
        if (!model?.internalModel?.coreModel) {
            console.debug(DEBUG_PREFIX, `Model destroyed, stopping body movement for ${character}`);
            state.isRunning = false;
            break;
        }
        
        // Обновляем движения
        try {
            await updateBodyMovement(character, model, settings);
        } catch (error) {
            console.debug(DEBUG_PREFIX, `Error in body movement update for ${character}:`, error);
            state.isRunning = false;
            break;
        }
        
        // Ждём перед следующим обновлением
        await delay(UPDATE_INTERVAL_MS);
    }
    
    state.isRunning = false;
    console.debug(DEBUG_PREFIX, `Body movement stopped for ${character}`);
}

// Экспортируемые функции

async function startBodyMovement(character, model, model_path) {
    // Создаём состояние, если его нет
    if (!bodyMovementStates[character]) {
        bodyMovementStates[character] = new BodyMovementState(character);
    }
    
    const state = bodyMovementStates[character];
    
    // БАГ 2 FIX: Проверяем, что цикл не запущен
    if (state.isRunning) {
        console.debug(DEBUG_PREFIX, `Body movement already running for ${character}`);
        return;
    }
    
    // БАГ 2 FIX: Запускаем цикл без await (фоновый процесс)
    bodyMovementLoop(character, model, model_path).catch(error => {
        console.debug(DEBUG_PREFIX, `Body movement loop error for ${character}:`, error);
        state.isRunning = false;
    });
}

async function stopBodyMovement(character) {
    const state = bodyMovementStates[character];
    if (!state) return;
    
    console.debug(DEBUG_PREFIX, `Stopping body movement for ${character}`);
    state.isRunning = false;
    
    // БАГ 6 FIX: Ждем подтверждения остановки с таймаутом
    const maxWaitTime = UPDATE_INTERVAL_MS * 10; // Максимум 500мс ожидания
    const startWait = Date.now();
    
    while (state.isRunning && (Date.now() - startWait) < maxWaitTime) {
        await delay(UPDATE_INTERVAL_MS);
    }
    
    if (state.isRunning) {
        console.debug(DEBUG_PREFIX, `Force stopped body movement for ${character} (timeout)`);
        state.isRunning = false;
    }
}

async function restartBodyMovement(character, model, model_path) {
    // БАГ 2 & 6 FIX: Гарантируем полную остановку перед перезапуском
    await stopBodyMovement(character);
    
    // Дополнительная задержка для гарантии очистки
    await delay(UPDATE_INTERVAL_MS);
    
    // Перезапускаем систему
    await startBodyMovement(character, model, model_path);
}

// БАГ 4 FIX: Функция очистки состояния персонажа
export function cleanupBodyMovement(character) {
    if (bodyMovementStates[character]) {
        bodyMovementStates[character].isRunning = false;
        delete bodyMovementStates[character];
        console.debug(DEBUG_PREFIX, `Cleaned up body movement state for ${character}`);
    }
}

// Экспортируем функцию для обновления состояния из playTalk
export function notifyMouthActivity(character, isActive) {
    updateMovementState(character, isActive);
}
