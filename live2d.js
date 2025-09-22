
import { trimToEndSentence, trimToStartSentence } from '../../../utils.js';
import { getRequestHeaders, saveSettings, saveSettingsDebounced, sendMessageAsUser } from '../../../../script.js';
import { getContext, extension_settings, getApiUrl, doExtrasFetch, modules } from '../../../extensions.js';

import {
    DEBUG_PREFIX,
    live2d,
    FALLBACK_EXPRESSION,
    CANVAS_ID,
    delay,
    SPRITE_DIV,
    VN_MODE_DIV,
    ID_PARAM_PATCH,
} from './constants.js';

export {
    loadLive2d,
    updateExpression,
    rescaleModel,
    moveModel,
    removeModel,
    playExpression,
    playMotion,
    playTalk,
    playMessage,
    resetParameters,
    setParameter,
    setVisible,
    charactersWithModelLoaded,
    forceLoopAnimation,
    startAutoAnimations,
    stopAutoAnimations,
    restartAutoAnimations,
    autoMicrosaccades,
};

let models = {};
let app = null;
let is_talking = {};
let abortTalking = {};
let previous_interaction = { 'character': '', 'message': '' };
let last_motion = {};
let autoAnimationsRunning = {}; // Track which animations are running for each character

const EXPRESSION_API = {
    local: 0,
    extras: 1,
    llm: 2,
};

async function onHitAreasClick(character, hitAreas) {
    const model_path = extension_settings.live2d.characterModelMapping[character];
    const model = models[character];
    const model_hit_areas = model.internalModel.hitAreas;
    let model_expression;
    let model_motion;
    let message;

    if (model.is_dragged) {
        console.debug(DEBUG_PREFIX,'Model is being dragged cancel hit detection');
        return;
    }

    console.debug(DEBUG_PREFIX,'Detected click on hit areas:', hitAreas, 'of', model.tag);
    console.debug(DEBUG_PREFIX,'Checking priority from:', model_hit_areas);

    let selected_area;
    let selected_area_priority;
    for (const area in model_hit_areas) {
        if (!hitAreas.includes(area))
            continue;
        console.debug(DEBUG_PREFIX,'Checking',model_hit_areas[area]);

        // Check area mapping
        model_expression = extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][area]['expression'];
        model_motion = extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][area]['motion'];
        message = extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][area]['message'];

        if (model_expression == 'none' && model_motion == 'none' && message == '') {
            console.debug(DEBUG_PREFIX,'No animation or message mapped, ignored.');
            continue;
        }

        if (selected_area === undefined || model_hit_areas[area].index < selected_area_priority) {
            selected_area = model_hit_areas[area].name;
            selected_area_priority = model_hit_areas[area].index;
            console.debug(DEBUG_PREFIX,'higher priority selected',selected_area);
        }
    }


    // No hit area found with mapping, set click mapping
    if (selected_area === undefined) {
        console.debug(DEBUG_PREFIX,'No hit area with mapping found, fallback to default click behavior:',extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']);
        model_expression = extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']['expression'];
        model_motion = extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']['motion'];
        message = extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']['message'];
    }
    else {
        console.debug(DEBUG_PREFIX,'Highest priority area with mapping found:', selected_area,extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][selected_area]);
        model_expression = extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][selected_area]['expression'];
        model_motion = extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][selected_area]['motion'];
        message = extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][selected_area]['message'];
    }

    if (message != '') {
        console.debug(DEBUG_PREFIX,getContext());
        // Same interaction as last message
        if (getContext().chat[getContext().chat.length - 1].is_user && previous_interaction['character'] == character && previous_interaction['message'] == message) {
            console.debug(DEBUG_PREFIX,'Same as last interaction, nothing done');
        }
        else {
            previous_interaction['character'] = character;
            previous_interaction['message'] = message;

            $('#send_textarea').val(''); // clear message area to avoid double message
            sendMessageAsUser(message);
            if (extension_settings.live2d.autoSendInteraction) {
                await getContext().generate();
            }
        }
    }
    else
        console.debug(DEBUG_PREFIX,'Mapped message empty, nothing to send.');

    if (model_expression != 'none') {
        await playExpression(character, model_expression);
        console.debug(DEBUG_PREFIX,'Playing hit area expression', model_expression);
    }

    if (model_motion != 'none') {
        //model.internalModel.motionManager.stopAllMotions();
        await playMotion(character,model_motion);
        console.debug(DEBUG_PREFIX,'Playing hit area motion', model_motion);
    }
}

async function onClick(model, x, y) {
    const character = model.st_character;
    const hit_areas = await model.hitTest(x,y);
    console.debug(DEBUG_PREFIX, 'Click areas at',x,y,':',hit_areas);

    // Hit area will handle the click
    if (hit_areas.length > 0) {
        console.debug(DEBUG_PREFIX,'Hit areas function will handle the click.');
        return;
    }
    else
        onHitAreasClick(character,[]); // factorisation: will just play default
}

function draggable(model) {
    model.buttonMode = true;
    model.on('pointerdown', (e) => {
        model.dragging = true;
        model._pointerX = e.data.global.x - model.x;
        model._pointerY = e.data.global.y - model.y;
    });
    model.on('pointermove', (e) => {
        if (model.dragging) {
            const new_x = e.data.global.x - model._pointerX;
            const new_y = e.data.global.y - model._pointerY;
            model.is_dragged = (model.position.x != new_x ) || (model.position.y != new_y);
            console.debug(DEBUG_PREFIX,'Draging model',model.is_dragged);

            model.position.x = new_x;
            model.position.y = new_y;

            // Save new center relative location
            const character = model.st_character;
            const model_path = model.st_model_path;
            //console.debug(DEBUG_PREFIX,"Dragging",character,model_path, "to", model.position, "canvas", innerWidth,innerHeight);
            extension_settings.live2d.characterModelsSettings[character][model_path]['x'] = Math.round(((model.x + (model.width / 2)) - (innerWidth / 2)) / (innerWidth / 2 / 100));
            extension_settings.live2d.characterModelsSettings[character][model_path]['y'] = Math.round(((model.y + (model.height / 2)) - (innerHeight / 2)) / (innerHeight / 2 / 100));
            saveSettingsDebounced();
            $('#live2d_model_x').val(extension_settings.live2d.characterModelsSettings[character][model_path]['x']);
            $('#live2d_model_x').val(extension_settings.live2d.characterModelsSettings[character][model_path]['x']);
            $('#live2d_model_x_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['x']);
            $('#live2d_model_y_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['y']);
        //console.debug(DEBUG_PREFIX,"New offset to center",extension_settings.live2d.characterModelsSettings[character][model_path]["x"],extension_settings.live2d.characterModelsSettings[character][model_path]["y"]);
        }
    });
    model.on('pointerupoutside', async () => {model.dragging = false; await delay(100); model.is_dragged = false;}); // wait to cancel click detection
    model.on('pointerup', async () => {model.dragging = false; await delay(100); model.is_dragged = false;});
}

function showFrames(model) {
    const foreground = PIXI.Sprite.from(PIXI.Texture.WHITE);
    foreground.width = model.internalModel.width;
    foreground.height = model.internalModel.height;
    foreground.alpha = 0.2;
    foreground.visible = true;

    const hitAreaFrames = new live2d.HitAreaFrames();
    hitAreaFrames.visible = true;

    model.addChild(foreground);
    model.addChild(hitAreaFrames);
}

async function loadLive2d(visible = true) {
    console.debug(DEBUG_PREFIX, 'Updating live2d app.');
    // 1) Cleanup memory
    // Reset the PIXI app
    if(app !== null) {
        app.destroy();
        app = null;
    }

    // Delete the canvas
    if (document.getElementById(CANVAS_ID) !== null)
        document.getElementById(CANVAS_ID).remove();

    // Delete live2d models from memory
    for (const character in models) {
        models[character].destroy(true, true, true);
        delete models[character];
        console.debug(DEBUG_PREFIX,'Delete model from memory for', character);
    }

    if (!extension_settings.live2d.enabled) {
        // Show solo chat sprite
        $('#' + SPRITE_DIV).removeClass('live2d-hidden');
        $('#' + VN_MODE_DIV).removeClass('live2d-hidden');
        return;
    }

    // Hide sprite divs
    $('#' + SPRITE_DIV).addClass('live2d-hidden');
    $('#' + VN_MODE_DIV).addClass('live2d-hidden');

    // Create new canvas and PIXI app
    var canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    if (!visible)
        canvas.classList.add('live2d-hidden');


    // TODO: factorise
    const context = getContext();
    const group_id = context.groupId;
    let chat_members = [context.name2];

    if (group_id !== null) {
        chat_members = [];
        for(const i of context.groups) {
            if (i.id == context.groupId) {
                for(const j of i.members) {
                    let char_name = j.replace(/\.[^/.]+$/, '');
                    if (char_name.includes('default_'))
                        char_name = char_name.substring('default_'.length);

                    chat_members.push(char_name);
                }
            }
        }
    }

    $('body').append(canvas);

    app = new PIXI.Application({
        resolution: 2 * window.devicePixelRatio,
        view: document.getElementById(CANVAS_ID),
        autoStart: true,
        resizeTo: window,
        backgroundAlpha: 0,
    });

    console.debug(DEBUG_PREFIX,'Loading models of',chat_members);

    // Load each character model
    let offset = 0;
    for (const character of chat_members) {
        console.debug(DEBUG_PREFIX,'Loading model of',character);

        if (extension_settings.live2d.characterModelMapping[character] === undefined)
            continue;

        console.debug(DEBUG_PREFIX,'Loading',extension_settings.live2d.characterModelMapping[character]);

        const model_path = extension_settings.live2d.characterModelMapping[character];
        var m;
        try{
            m = await live2d.Live2DModel.from(model_path, null, extension_settings.live2d.characterModelsSettings[character][model_path]['eye']||45);
        }catch{
            m = await live2d.Live2DModel.from(model_path);
        }
        const model = m;
        model.st_character = character;
        model.st_model_path = model_path;
        model.is_dragged = false;
        console.debug(DEBUG_PREFIX,'loaded',model);

        // Apply basic cursor animations
        if (model.internalModel !== undefined) {
            try{
                for (const param in extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']) {
                    model.internalModel[param] = extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param'][param];
                    console.debug(DEBUG_PREFIX,'Assigned parameter',param,'as',model.internalModel[param]);
                }
            }catch{
                continue;
            }
        }
        /*
            console.debug(DEBUG_PREFIX,"Checking model basic animations parameters:",model_parameter_ids);
            for (const param in ID_PARAM_PATCH) {
                let param_id = model.internalModel[param];
                if (param_id === undefined) {
                    console.debug(DEBUG_PREFIX,"Parameter does not exist maybe no animation possible for", param);
                    continue;
                }
                if (!model_parameter_ids.includes(param_id)) {
                    let patched = false;
                    console.debug(DEBUG_PREFIX,"Parameter not found:",param_id);
                    for (param_id of ID_PARAM_PATCH[param]){
                        if(model_parameter_ids.includes(param_id)) {
                            model.internalModel[param] = param_id
                            console.debug(DEBUG_PREFIX,"Found alternative param id:",param_id)
                            patched = true;
                            break
                        }
                    }

                    if (!patched)
                        console.log(DEBUG_PREFIX,"WARNING, cannot find corresponding parameter for",param);
                }
            }
        }*/

        models[character] = model;
        app.stage.addChild(model);

        const scaleY = ((innerHeight) / model.height) * extension_settings.live2d.characterModelsSettings[character][model_path]['scale'];

        // Scale to canvas
        model.scale.set(scaleY);

        moveModel(character, extension_settings.live2d.characterModelsSettings[character][model_path]['x'], extension_settings.live2d.characterModelsSettings[character][model_path]['y']);

        draggable(model);

        // Debug frames
        if (extension_settings.live2d.showFrames)
            showFrames(model);

        // handle tapping
        model.on('hit', (hitAreas) => onHitAreasClick(character, hitAreas));
        model.on('click', (e) => onClick(model, e.data.global.x,e.data.global.y));

        // Set cursor behavior
        model.autoInteract = extension_settings.live2d.followCursor;
        
        // Start auto animations
        startAutoAnimations(character);
        
        console.debug(DEBUG_PREFIX, 'Finished loading model:', model);
    }
    console.debug(DEBUG_PREFIX, 'Models:', models);
}

async function updateExpression(chat_id) {
    const message = getContext().chat[chat_id];
    const character = message.name;
    const model_path = extension_settings.live2d.characterModelMapping[character];

    console.debug(DEBUG_PREFIX,'received new message :', message.mes);

    if (message.is_user)
        return;

    if (model_path === undefined) {
        console.debug(DEBUG_PREFIX, 'No model assigned to', character);
        return;
    }

    const expression = await getExpressionLabel(message.mes);
    let model_expression = extension_settings.live2d.characterModelsSettings[character][model_path]['classify_mapping'][expression]['expression'];
    let model_motion = extension_settings.live2d.characterModelsSettings[character][model_path]['classify_mapping'][expression]['motion'];

    console.debug(DEBUG_PREFIX,'Detected expression in message:',expression);

    // Fallback animations
    if (model_expression == 'none') {
        console.debug(DEBUG_PREFIX,'Expression is none, applying default expression', model_expression);
        model_expression = extension_settings.live2d.characterModelsSettings[character][model_path]['animation_default']['expression'];
    }

    if (model_motion == 'none') {
        console.debug(DEBUG_PREFIX,'Motion is none, playing default motion',model_motion);
        model_motion = extension_settings.live2d.characterModelsSettings[character][model_path]['animation_default']['motion'];
    }

    console.debug(DEBUG_PREFIX,'Playing expression',expression,':', model_expression, model_motion);

    if (model_expression != 'none') {
        models[character].expression(model_expression);
    }

    if (model_motion != 'none') {
        await playMotion(character, model_motion);
    }
}

async function getExpressionLabel(text) {
    // Return if text is undefined, saving a costly fetch request
    if ((!modules.includes('classify') && extension_settings.expressions.api === EXPRESSION_API.extras) || !text) {
        return FALLBACK_EXPRESSION;
    }

    text = sampleClassifyText(text);

    try {
        // TODO: proper LLM classification
        if (extension_settings.expressions.api === EXPRESSION_API.local || extension_settings.api === EXPRESSION_API.llm) {
            // Local transformers pipeline
            const apiResult = await fetch('/api/extra/classify', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ text: text }),
            });

            if (apiResult.ok) {
                const data = await apiResult.json();
                return data.classification[0].label;
            }
        } else if (extension_settings.expressions.api === EXPRESSION_API.extras) {
            // Extras
            const url = new URL(getApiUrl());
            url.pathname = '/api/classify';

            const apiResult = await doExtrasFetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Bypass-Tunnel-Reminder': 'bypass',
                },
                body: JSON.stringify({ text: text }),
            });

            if (apiResult.ok) {
                const data = await apiResult.json();
                return data.classification[0].label;
            }
        } else {
            return FALLBACK_EXPRESSION;
        }
    } catch (error) {
        console.log(error);
        return FALLBACK_EXPRESSION;
    }
}

function moveModel(character, x, y) {
    if (models[character] === undefined)
        return;

    const model = models[character];
    model.x = ((innerWidth / 2) - (model.width / 2)) + (innerWidth / 2) * x / 100;
    model.y = ((innerHeight / 2) - (model.height / 2)) + (innerHeight / 2) * y / 100;
}

async function rescaleModel(character) {
    if (models[character] !== undefined) {
        const model_path = $('#live2d_model_select').val();
        const model = models[character];
        const scaleY = ((innerHeight) / model.internalModel.height) * extension_settings.live2d.characterModelsSettings[character][model_path]['scale'];
        model.scale.set(scaleY);
        moveModel(character, extension_settings.live2d.characterModelsSettings[character][model_path]['x'], extension_settings.live2d.characterModelsSettings[character][model_path]['y']);
    }
}

async function removeModel(character) {
    if (models[character] !== undefined) {
        models[character].destroy(true, true, true);
        delete models[character];
        console.debug(DEBUG_PREFIX,'Delete model from memory for', character);
    }
}

/**
 * Processes the classification text to reduce the amount of text sent to the API.
 * Quotes and asterisks are to be removed. If the text is less than 300 characters, it is returned as is.
 * If the text is more than 300 characters, the first and last 150 characters are returned.
 * The result is trimmed to the end of sentence.
 * @param {string} text The text to process.
 * @returns {string}
 */
function sampleClassifyText(text) {
    if (!text) {
        return text;
    }

    // Remove asterisks and quotes
    let result = text.replace(/[\*\"]/g, '');

    const SAMPLE_THRESHOLD = 300;
    const HALF_SAMPLE_THRESHOLD = SAMPLE_THRESHOLD / 2;

    if (text.length < SAMPLE_THRESHOLD) {
        result = trimToEndSentence(result);
    } else {
        result = trimToEndSentence(result.slice(0, HALF_SAMPLE_THRESHOLD)) + ' ' + trimToStartSentence(result.slice(-HALF_SAMPLE_THRESHOLD));
    }

    return result.trim();
}

async function playExpression(character, expression) {
    if (models[character] === undefined)
        return;

    const model = models[character];
    console.debug(DEBUG_PREFIX,character,'playing expression',expression);
    await model.expression(expression);
}

async function playMotion(character, motion, force = false) {
    if (models[character] === undefined)
        return;

    console.debug(DEBUG_PREFIX,character,'decoding motion',motion);

    // Reset model to force animation
    if (force || extension_settings.live2d.force_animation) {
        console.debug(DEBUG_PREFIX,'force model reloading models');
        await loadLive2d();
        //models[character].internalModel.motionManager.stopAllMotions();
    }

    const model = models[character];
    const motion_label_split = motion.split('_id=');
    const motion_label = motion_label_split[0];
    const motion_id = motion_label_split[1];


    console.debug(DEBUG_PREFIX,character,'playing motion',motion_label,motion_id);

    if (motion_id == 'random')
        await model.motion(motion_label);
    else
        await model.motion(motion_label,motion_id);

    last_motion[character] = motion;
}

async function playTalk(character, text) {
    console.debug(DEBUG_PREFIX,'Playing mouth animation for',character,'message:',text);
    // No model loaded for character
    if (models[character] === undefined)
        return;

    abortTalking[character] = false;

    // Character is already talking TODO: stop previous talk animation
    if (is_talking[character] !== undefined && is_talking[character] == true) {
        console.debug(DEBUG_PREFIX,'Character is already talking abort');
        while (is_talking[character]) {
            abortTalking[character] = true;
            await delay(100);
        }
        abortTalking[character] = false;
        console.debug(DEBUG_PREFIX,'Start new talk');
        //return;
    }

    const model = models[character];
    const model_path = extension_settings.live2d.characterModelMapping[character];
    const parameter_mouth_open_y_id = extension_settings.live2d.characterModelsSettings[character][model_path]['param_mouth_open_y_id'];
    const mouth_open_speed = extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_open_speed'];
    const mouth_time_per_character = extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_time_per_character'];

    // No mouth parameter set
    if (parameter_mouth_open_y_id == 'none') {
        return;
    }

    if (typeof model.internalModel.coreModel.addParameterValueById !== 'function') {
        console.debug(DEBUG_PREFIX,'Model has no addParameterValueById function cannot animate mouth');
        return;
    }
	
	is_talking[character] = true;
	let startTime = Date.now();
	const duration = text.length * mouth_time_per_character;
	let turns = 0;
	let mouth_y = 0;
	window.live2d_tts_bind = false; // @4eckme
	while ((Date.now() - startTime) < duration || true) { // @4eckme
		
		// start @4eckme
		model.internalModel.coreModel.addParameterValueById(parameter_mouth_open_y_id, -100);
		while (window.live2d_tts_bind === false) {
			await delay(20);
		}
		// end @4eckme

		if (abortTalking[character]) {
            console.debug(DEBUG_PREFIX,'Abort talking requested.');
            break;
        }

        // Model destroyed during animation
        if (model?.internalModel?.coreModel === undefined) {
            console.debug(DEBUG_PREFIX,'Model destroyed during talking animation, abort');
            break;
        }

        mouth_y = Math.sin((Date.now() - startTime));
        model.internalModel.coreModel.addParameterValueById(parameter_mouth_open_y_id, mouth_y);
        //console.debug(DEBUG_PREFIX,"Mouth_y:", mouth_y, "VS",model.internalModel.coreModel.getParameterValueById(parameter_mouth_open_y_id), "remaining time", duration - (Date.now() - startTime));
        await delay(100 / mouth_open_speed);
        turns += 1;
    }

    if (model?.internalModel?.coreModel !== undefined)
        model.internalModel.coreModel.addParameterValueById(parameter_mouth_open_y_id, -100); // close mouth
    is_talking[character] = false;
}

async function playMessage(chat_id) {
    const character = getContext().chat[chat_id].name;

    // No model for user or system
    if (getContext().chat[chat_id].is_user || getContext().chat[chat_id].is_system)
        return;

    const message = getContext().chat[chat_id].mes;
    playTalk(character, message);
}

// Sets a parameter value using an ID
async function setParameter(character, paramId, paramValue) {
    const model = models[character];
    model.internalModel.coreModel.setParameterValueById(paramId, paramValue);
}

// Resets all parameters to default
async function resetParameters(character) {
    const model = models[character];
    model.internalModel.coreModel._model.parameters.defaultValues.forEach((defaultValue, paramIndex) => {
        model.internalModel.coreModel.setParameterValueByIndex(paramIndex, defaultValue);
    });
}

function setVisible() {
    $('#' + CANVAS_ID).removeClass('live2d-hidden');
}

function charactersWithModelLoaded() {
    return Object.keys(models);
}

function forceLoopAnimation() {
    for (const character in models) {
        const model = models[character];
        model.internalModel.motionManager.playing;

        if (model.internalModel.motionManager.playing) {
            //console.debug(DEBUG_PREFIX,"Already playing motion wating for looping");
            continue;
        }

        if (last_motion[character] !== undefined) {
            playMotion(character, last_motion[character]);
            //console.debug(DEBUG_PREFIX,"Force looping of motion",motion);
        }
    }
}
async function autoBreathing(character) {
    const model = models[character];
    if (!model) return;
    
    // Проверяем, включены ли автоматические анимации
    if (!extension_settings.live2d.autoAnimationsEnabled) return;
    
    // Отмечаем, что анимация дыхания запущена
    if (!autoAnimationsRunning[character]) {
        autoAnimationsRunning[character] = {};
    }
    autoAnimationsRunning[character].breathing = true;
    
    const model_path = extension_settings.live2d.characterModelMapping[character];
    const BREATH_PARAMETER_ID = extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamBreath'] || "PARAM_BREATH";
    
    // Фиксируем параметры на момент запуска (не читаем в реальном времени)
    const BREATH_SPEED = extension_settings.live2d.autoBreathSpeed || 0.5;
    const BREATH_AMOUNT = extension_settings.live2d.autoBreathAmplitude || 0.5;
    
    while (true) {
        // Проверяем, что модель всё ещё существует и анимации включены
        if (model?.internalModel?.coreModel === undefined || !extension_settings.live2d.autoAnimationsEnabled) {
            console.debug(DEBUG_PREFIX, 'Model destroyed or animations disabled, stopping breathing animation');
            autoAnimationsRunning[character].breathing = false;
            break;
        }
        
        const time = Date.now() / 1000; // Текущее время в секундах
        const value = BREATH_AMOUNT * Math.sin(BREATH_SPEED * time);
        
        // Отладочная информация - показываем значение дыхания каждые 2 секунды
        if (Math.floor(time) % 2 === 0 && Math.floor(time * 10) % 10 === 0) {
            console.debug(DEBUG_PREFIX, `Breath value: ${value.toFixed(3)} (amount=${BREATH_AMOUNT}, speed=${BREATH_SPEED})`);
        }
        
        try {
            model.internalModel.coreModel.addParameterValueById(BREATH_PARAMETER_ID, value);
        } catch (error) {
            console.debug(DEBUG_PREFIX, 'Error animating breath parameter:', error);
            autoAnimationsRunning[character].breathing = false;
            break;
        }
        
        await delay(50); // 20 FPS обновление
    }
    
    autoAnimationsRunning[character].breathing = false;
}
async function autoMicrosaccades(character) {
    const model = models[character];
    if (!model) return;
    
    // Проверяем, включены ли автоматические анимации и микросаккады
    if (!extension_settings.live2d.autoAnimationsEnabled || !extension_settings.live2d.microsaccadesEnabled) return;
    
    // Отмечаем, что анимация микросаккад запущена
    if (!autoAnimationsRunning[character]) {
        autoAnimationsRunning[character] = {};
    }
    autoAnimationsRunning[character].microsaccades = true;
    
    const model_path = extension_settings.live2d.characterModelMapping[character];
    const EYE_X_PARAM_ID = extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamEyeBallX'] || "PARAM_EYE_BALL_X";
    const EYE_Y_PARAM_ID = extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamEyeBallY'] || "PARAM_EYE_BALL_Y";
    
    // Параметры микросаккад (фиксированные на момент запуска)
    const MICROSACCADE_AMPLITUDE = extension_settings.live2d.microsaccadeAmplitude || 0.02;
    const MICROSACCADE_FREQUENCY = extension_settings.live2d.microsaccadeFrequency || 1.0;
    const MICROSACCADE_DURATION = extension_settings.live2d.microsaccadeDuration || 15;
    const MICROSACCADE_INTERVAL_MIN = extension_settings.live2d.microsaccadeIntervalMin || 300;
    const MICROSACCADE_INTERVAL_MAX = extension_settings.live2d.microsaccadeIntervalMax || 1500;
    
    console.debug(DEBUG_PREFIX, `Microsaccades params for ${character}:`, {
        MICROSACCADE_AMPLITUDE, MICROSACCADE_FREQUENCY, MICROSACCADE_DURATION,
        MICROSACCADE_INTERVAL_MIN, MICROSACCADE_INTERVAL_MAX
    });
    
    while (true) {
        // Проверяем, что модель существует и анимации включены
        if (model?.internalModel?.coreModel === undefined || 
            !extension_settings.live2d.autoAnimationsEnabled || 
            !extension_settings.live2d.microsaccadesEnabled) {
            console.debug(DEBUG_PREFIX, 'Model destroyed or microsaccades disabled, stopping microsaccades');
            autoAnimationsRunning[character].microsaccades = false;
            break;
        }
        
        try {
            // Получаем текущее положение глаз
            let currentX = 0;
            let currentY = 0;
            
            try {
                currentX = model.internalModel.coreModel.getParameterValueById(EYE_X_PARAM_ID) || 0;
                currentY = model.internalModel.coreModel.getParameterValueById(EYE_Y_PARAM_ID) || 0;
            } catch (error) {
                // Если не можем получить текущие значения, используем 0
                currentX = 0;
                currentY = 0;
            }
            
            // Генерируем случайное направление для микросаккады
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * MICROSACCADE_AMPLITUDE;
            
            const microsaccadeX = Math.cos(angle) * distance;
            const microsaccadeY = Math.sin(angle) * distance;
            
            // Применяем микросаккаду как относительное смещение
            const targetX = currentX + microsaccadeX;
            const targetY = currentY + microsaccadeY;
            
            // Быстрое движение к новой позиции (саккада)
            const SACCADE_STEPS = Math.max(2, Math.floor(MICROSACCADE_DURATION / 5));
            const SACCADE_DELAY = Math.floor(MICROSACCADE_DURATION / SACCADE_STEPS);
            
            for (let step = 0; step <= SACCADE_STEPS; step++) {
                const progress = step / SACCADE_STEPS;
                // Быстрое движение с затуханием в конце
                const eased = progress < 0.8 ? progress * 1.25 : 1 - Math.pow(2 * (1 - progress), 2);
                
                const currentPosX = currentX + (targetX - currentX) * eased;
                const currentPosY = currentY + (targetY - currentY) * eased;
                
                // Применяем только относительное смещение, не перезаписывая основное положение
                model.internalModel.coreModel.addParameterValueById(EYE_X_PARAM_ID, microsaccadeX * eased);
                model.internalModel.coreModel.addParameterValueById(EYE_Y_PARAM_ID, microsaccadeY * eased);
                
                await delay(SACCADE_DELAY);
            }
            
            // Возвращаемся к исходной позиции (дрифт)
            const DRIFT_STEPS = Math.max(3, Math.floor(MICROSACCADE_DURATION / 3));
            const DRIFT_DELAY = Math.floor(MICROSACCADE_DURATION / DRIFT_STEPS);
            
            for (let step = 0; step <= DRIFT_STEPS; step++) {
                const progress = step / DRIFT_STEPS;
                const eased = 1 - Math.pow(1 - progress, 2); // Плавное возвращение
                
                const returnX = microsaccadeX * (1 - eased);
                const returnY = microsaccadeY * (1 - eased);
                
                model.internalModel.coreModel.addParameterValueById(EYE_X_PARAM_ID, returnX - microsaccadeX);
                model.internalModel.coreModel.addParameterValueById(EYE_Y_PARAM_ID, returnY - microsaccadeY);
                
                await delay(DRIFT_DELAY);
            }
            
            console.debug(DEBUG_PREFIX, `Microsaccade: direction=${angle.toFixed(2)}, distance=${distance.toFixed(4)}, duration=${MICROSACCADE_DURATION}ms`);
            
            // Случайный интервал до следующей микросаккады
            const interval = MICROSACCADE_INTERVAL_MIN + Math.random() * (MICROSACCADE_INTERVAL_MAX - MICROSACCADE_INTERVAL_MIN);
            await delay(interval);
            
        } catch (error) {
            console.debug(DEBUG_PREFIX, 'Error animating microsaccades:', error);
            autoAnimationsRunning[character].microsaccades = false;
            break;
        }
    }
    
    autoAnimationsRunning[character].microsaccades = false;
}

async function autoEyeMovement(character) {
    const model = models[character];
    if (!model) return;
    
    // Проверяем, включены ли автоматические анимации
    if (!extension_settings.live2d.autoAnimationsEnabled) return;
    
    // Отмечаем, что анимация глаз запущена
    if (!autoAnimationsRunning[character]) {
        autoAnimationsRunning[character] = {};
    }
    autoAnimationsRunning[character].eyeMovement = true;
    
    const model_path = extension_settings.live2d.characterModelMapping[character];
    const EYE_X_PARAM_ID = extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamEyeBallX'] || "PARAM_EYE_BALL_X";
    const EYE_Y_PARAM_ID = extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamEyeBallY'] || "PARAM_EYE_BALL_Y";
    
    // Фиксируем параметры на момент запуска (не читаем в реальном времени)
    const CENTER_WEIGHT = extension_settings.live2d.autoEyeCenterWeight || 0.7;
    const AMPLITUDE_CENTER = extension_settings.live2d.autoEyeAmplitudeCenter || 0.25;
    const AMPLITUDE_PERIPHERAL = extension_settings.live2d.autoEyeAmplitudePeripheral || 1.0;
    const FIXATION_TIME_MIN = extension_settings.live2d.autoEyeFixationMin || 200;
    const FIXATION_TIME_MAX = extension_settings.live2d.autoEyeFixationMax || 2000;
    
    console.debug(DEBUG_PREFIX, `Eye movement params for ${character}:`, {
        CENTER_WEIGHT, AMPLITUDE_CENTER, AMPLITUDE_PERIPHERAL,
        FIXATION_TIME_MIN, FIXATION_TIME_MAX
    });
    
    // Текущее положение глаз
    let currentX = 0;
    let currentY = 0;
    
    // Сброс параметров глаз в начальное положение
    try {
        model.internalModel.coreModel.setParameterValueById(EYE_X_PARAM_ID, 0);
        model.internalModel.coreModel.setParameterValueById(EYE_Y_PARAM_ID, 0);
        console.debug(DEBUG_PREFIX, 'Reset eye parameters to (0, 0)');
    } catch (error) {
        console.debug(DEBUG_PREFIX, 'Error resetting eye parameters:', error);
    }
    
    while (true) {
        // Проверяем, что модель существует и анимации включены
        if (model?.internalModel?.coreModel === undefined || !extension_settings.live2d.autoAnimationsEnabled) {
            console.debug(DEBUG_PREFIX, 'Model destroyed or animations disabled, stopping eye movement');
            autoAnimationsRunning[character].eyeMovement = false;
            break;
        }
        
        try {
            // Определяем следующую точку фиксации
            let targetX, targetY;
            
            const lookChoice = Math.random();
            
            // CENTER_WEIGHT: 0% = всегда в центре, 100% = всегда по сторонам
            if (CENTER_WEIGHT === 0 || AMPLITUDE_PERIPHERAL === 0) {
                // Всегда смотрим в центральную зону
                if (Math.random() < 0.5) {
                    // 50% времени - прямо в центр
                    targetX = 0;
                    targetY = 0;
                    console.debug(DEBUG_PREFIX, `Direct center (weight=0): target=(0, 0)`);
                } else {
                    // 50% времени - рядом с центром (но только в малом радиусе)
                    const angle = Math.random() * Math.PI * 2;
                    const distance = Math.random() * Math.min(AMPLITUDE_CENTER, 0.05); // Ограничиваем центральную зону
                    targetX = Math.cos(angle) * distance;
                    targetY = Math.sin(angle) * distance;
                    console.debug(DEBUG_PREFIX, `Near center (weight=0): angle=${angle.toFixed(2)}, distance=${distance.toFixed(2)}, target=(${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);
                }
            } else if (CENTER_WEIGHT === 1) {
                // Всегда смотрим по сторонам (периферийная зона)
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.max(AMPLITUDE_CENTER, 0.1) + Math.random() * Math.max(AMPLITUDE_PERIPHERAL - AMPLITUDE_CENTER, 0.1);
                targetX = Math.cos(angle) * distance;
                targetY = Math.sin(angle) * distance;
                console.debug(DEBUG_PREFIX, `Always peripheral (weight=1): angle=${angle.toFixed(2)}, distance=${distance.toFixed(2)}, target=(${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);
            } else {
                // Смешанный режим - используем вероятность
                if (lookChoice < CENTER_WEIGHT) {
                    // Смотрим в периферийную зону
                    const angle = Math.random() * Math.PI * 2;
                    const distance = AMPLITUDE_CENTER + Math.random() * (AMPLITUDE_PERIPHERAL - AMPLITUDE_CENTER);
                    targetX = Math.cos(angle) * distance;
                    targetY = Math.sin(angle) * distance;
                    console.debug(DEBUG_PREFIX, `Peripheral look (weight=${CENTER_WEIGHT}): angle=${angle.toFixed(2)}, distance=${distance.toFixed(2)}, target=(${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);
                } else {
                    // Смотрим в центральную зону
                    if (Math.random() < 0.3) {
                        // 30% от центральных взглядов - прямо в центр
                        targetX = 0;
                        targetY = 0;
                        console.debug(DEBUG_PREFIX, `Direct center (weight=${CENTER_WEIGHT}): target=(0, 0)`);
                    } else {
                        // 70% от центральных взглядов - рядом с центром
                        const angle = Math.random() * Math.PI * 2;
                        const distance = Math.random() * AMPLITUDE_CENTER;
                        targetX = Math.cos(angle) * distance;
                        targetY = Math.sin(angle) * distance;
                        console.debug(DEBUG_PREFIX, `Near center (weight=${CENTER_WEIGHT}): angle=${angle.toFixed(2)}, distance=${distance.toFixed(2)}, target=(${targetX.toFixed(2)}, ${targetY.toFixed(2)})`);
                    }
                }
            }
            
            // Плавная интерполяция к новой позиции (саккада)
            const SACCADE_STEPS = 6; // Количество шагов для плавности
            const SACCADE_DELAY = 5; // Задержка между шагами (мс)
            
            for (let step = 0; step <= SACCADE_STEPS; step++) {
                const progress = step / SACCADE_STEPS;
                // Используем easing функцию для более естественного движения
                const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                
                const currentPosX = currentX + (targetX - currentX) * eased;
                const currentPosY = currentY + (targetY - currentY) * eased;
                
                // Используем setParameterValueById для абсолютных позиций
                model.internalModel.coreModel.setParameterValueById(EYE_X_PARAM_ID, currentPosX);
                model.internalModel.coreModel.setParameterValueById(EYE_Y_PARAM_ID, currentPosY);
                
                if (step === SACCADE_STEPS) {
                    console.debug(DEBUG_PREFIX, `Final eye position: X=${currentPosX.toFixed(3)}, Y=${currentPosY.toFixed(3)}`);
                }
                
                await delay(SACCADE_DELAY);
            }
            
            // Обновляем текущую позицию
            currentX = targetX;
            currentY = targetY;
            
            // Фиксация взгляда (просто ждём случайное время)
            const fixationTime = FIXATION_TIME_MIN + Math.random() * (FIXATION_TIME_MAX - FIXATION_TIME_MIN);
            console.debug(DEBUG_PREFIX, `Fixation for ${fixationTime.toFixed(0)}ms`);
            await delay(fixationTime);
            
        } catch (error) {
            console.debug(DEBUG_PREFIX, 'Error animating eyes:', error);
            autoAnimationsRunning[character].eyeMovement = false;
            break;
        }
    }
    
    autoAnimationsRunning[character].eyeMovement = false;
}

// Функция для остановки всех анимаций персонажа
async function stopAutoAnimations(character) {
    console.debug(DEBUG_PREFIX, 'Stopping auto animations for', character);
    
    if (autoAnimationsRunning[character]) {
        autoAnimationsRunning[character].breathing = false;
        autoAnimationsRunning[character].eyeMovement = false;
        autoAnimationsRunning[character].microsaccades = false;
    }
    
    // Ждём немного, чтобы циклы завершились
    await delay(100);
}

// Функция для перезапуска всех анимаций персонажа
async function restartAutoAnimations(character) {
    console.debug(DEBUG_PREFIX, 'Restarting auto animations for', character);
    
    // Останавливаем текущие анимации
    await stopAutoAnimations(character);
    
    // Запускаем заново
    await startAutoAnimations(character);
}

// Функция для запуска всех автоматических анимаций для персонажа
async function startAutoAnimations(character) {
    if (!extension_settings.live2d.autoAnimationsEnabled) {
        console.debug(DEBUG_PREFIX, 'Auto animations disabled, not starting for', character);
        return;
    }
    
    console.debug(DEBUG_PREFIX, 'Starting auto animations for', character);
    
    // Инициализируем объект отслеживания анимаций
    if (!autoAnimationsRunning[character]) {
        autoAnimationsRunning[character] = {};
    }
    
    // Запускаем дыхание, если ещё не запущено
    if (!autoAnimationsRunning[character].breathing) {
        autoBreathing(character);
    }
    
    // Запускаем движение глаз, если ещё не запущено
    if (!autoAnimationsRunning[character].eyeMovement) {
        autoEyeMovement(character);
    }
    
    // Запускаем микросаккады, если ещё не запущены и они включены
    if (!autoAnimationsRunning[character].microsaccades && extension_settings.live2d.microsaccadesEnabled) {
        autoMicrosaccades(character);
    }
}
