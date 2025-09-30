import { saveSettingsDebounced, getRequestHeaders, callPopup } from '../../../../script.js';
import { getContext, extension_settings, renderExtensionTemplate } from '../../../extensions.js';

import {
    DEBUG_PREFIX,
    CHARACTER_LIVE2D_FOLDER,
    CLASSIFY_EXPRESSIONS,
    live2d,
    TEST_MESSAGE,
    delay,
    PARAM_MOUTH_OPEN_Y_DEFAULT,
    ID_PARAM_DEFAULT,
    extensionFolderPath,
} from './constants.js';

import {
    loadLive2d,
    rescaleModel,
    removeModel,
    moveModel,
    playExpression,
    playMotion,
    playTalk,
    setVisible,
} from './live2d.js';

import {
    currentChatMembers,
    loadModelParamUi,
    loadAnimationUi,
} from './utils.js';

import {
    startSelectDialog,
} from './gallery/gallery.js';

export {
    onEnabledClick,
    onFollowCursorClick,
    onAutoSendInteractionClick,
    onForceAnimationClick,
    onShowFramesClick,
    onForceLoopClick,
    onCharacterChange,
    onCharacterRefreshClick,
    onCharacterRemoveClick,
    onModelRefreshClick,
    onModelChange,
    onCharacterSelectClick,
    onModelScaleChange,
    onModelCoordChange,
    onModelEyeOffsetChange,
    onModelMouthChange,
    onModelParamChange,
    onModelParamResetClick,
    onModelParamDeleteClick,
    onAnimationMappingChange,
    onAutoAnimationsEnabledClick,
    onAutoEyeCenterWeightChange,
    onAutoEyeAmplitudeCenterChange,
    onAutoEyeAmplitudePeripheralChange,
    onAutoEyeFixationMinChange,
    onAutoEyeFixationMaxChange,
    onMicrosaccadesEnabledClick,
    onMicrosaccadeAmplitudeChange,
    onMicrosaccadeFrequencyChange,
    onMicrosaccadeDurationChange,
    onMicrosaccadeIntervalMinChange,
    onMicrosaccadeIntervalMaxChange,
    onRestartAnimationsClick,
    onResetCustomParamClick,
    onLogParametersClick,
    onCustomParamChange,
    onMouthLinkedParam1Change,
    onMouthLinkedParam2Change,
    onMouthLinkedParam3Change,
    onBodyMovementEnabledClick,
    onBodyMovementIdleIntensityChange,
    onBodyMovementTalkingIntensityChange,
    onBodyMovementImpulseChanceChange,
    onBodyMovementTalkingImpulseFrequencyChange,
    onBodyMovementTalkingImpulseMultiplierChange,
    onBodyMovementTalkingSpeedBoostChange,
    onBodyMovementDampingChange,
    onBodyMovementSpringStiffnessChange,
    onBodyMovementImpulseInertiaChange,
    onRestartBodyMovementClick,
    onEyeBlinkEnabledClick,
    onEyeBlinkSpeedChange,
    onLeftEyeParamChange,
    onRightEyeParamChange,
    onRestartEyeBlinkClick,
    updateCharactersModels,
    updateCharactersList,
    updateCharactersListOnce,
    playStarterAnimation,
    getCharacterLive2dFiles,
    getAssetsLive2dFiles,
};

let characters_list = [];
let characters_models = {};

async function onEnabledClick() {
    extension_settings.live2d.enabled = $('#live2d_enabled_checkbox').is(':checked');
    saveSettingsDebounced();

    await loadLive2d();
}

async function onFollowCursorClick() {
    extension_settings.live2d.followCursor = $('#live2d_follow_cursor_checkbox').is(':checked');
    saveSettingsDebounced();

    await loadLive2d();
}

async function onAutoSendInteractionClick() {
    extension_settings.live2d.autoSendInteraction = $('#live2d_auto_send_interaction_checkbox').is(':checked');
    saveSettingsDebounced();
}

async function onForceAnimationClick() {
    extension_settings.live2d.force_animation = $('#live2d_force_animation_checkbox').is(':checked');
    saveSettingsDebounced();
}

async function onShowFramesClick() {
    extension_settings.live2d.showFrames = $('#live2d_show_frames_checkbox').is(':checked');
    saveSettingsDebounced();
    await loadLive2d();
}

async function onForceLoopClick() {
    extension_settings.live2d.force_loop = $('#live2d_force_loop_checkbox').is(':checked');
    saveSettingsDebounced();
    await loadLive2d();
}

async function onCharacterChange() {
    const character = String($('#live2d_character_select').val());

    $('#live2d_model_div').hide();
    $('#live2d_model_settings').hide();

    if (character == 'none') {
        return;
    }

    $('#live2d_model_select')
        .find('option')
        .remove()
        .end()
        .append('<option value="none">None</option>')
        .val('none');

    if (characters_models[character] !== undefined) {
        for (const i of characters_models[character]) {
            //console.debug(DEBUG_PREFIX,"DEBUG",i)
            const model_folder = i[0].substring(0, i[0].lastIndexOf('/')).match(/([^\/]*)\/*$/)[1] + "/" + i[0].match(/([^\/]*)\/*$/)[1].replace('(assets folder)',''); // i[0] + ' (' + i[1].replace(/^.*[\\\/]/, '') + ')';
            const model_settings_path = i[1];
            $('#live2d_model_select').append(new Option(model_folder, model_settings_path));
        }
    }

    if (extension_settings.live2d.characterModelMapping[character] !== undefined) {
        $('#live2d_model_select').val(extension_settings.live2d.characterModelMapping[character]);
        $('#live2d_model_settings').show();
        loadModelUi();
    }

    $('#live2d_model_div').show();
}

async function onCharacterRefreshClick() {
    updateCharactersList();
    $('#live2d_character_select').val('none');
    $('#live2d_character_select').trigger('change');
}

async function onCharacterRemoveClick() {
    const character = String($('#live2d_character_select').val());

    if (character == 'none')
        return;

    let nb_character_models = 0;
    if (extension_settings.live2d.characterModelsSettings[character] !== undefined)
        nb_character_models = Object.keys(extension_settings.live2d.characterModelsSettings[character]).length;
    const template = `<div class="m-b-1">Are you sure you want to remove all live2d model settings for character ${character}? (model settings: ${nb_character_models})</div>`;
    const confirmation = await callPopup(template, 'confirm');

    if (confirmation) {
        $('#live2d_model_select').val('none');
        $('#live2d_model_settings').hide();
        delete extension_settings.live2d.characterModelMapping[character];
        delete extension_settings.live2d.characterModelsSettings[character];
        saveSettingsDebounced();
        await removeModel(character);
        console.debug(DEBUG_PREFIX, 'Deleted all settings for', character);
    }
    else {
        console.debug(DEBUG_PREFIX, 'Connection refused by user');
    }
}

async function onCharacterSelectClick() {
    fetch(`${extensionFolderPath}/gallery/galleryDlg.html`)
        .then(resp => resp.text())
        .then(data => {
            startSelectDialog(data);
        })
        .catch(err => console.error('Error loading the Dialog', err));
}

async function onModelRefreshClick() {
    updateCharactersModels(true);
    $('#live2d_model_select').val('none');
    $('#live2d_model_select').trigger('change');
}

async function onModelChange(event, galleryPath = null) {
    const character = String($('#live2d_character_select').val());
    if(galleryPath)
        $('#live2d_model_select').val(galleryPath);
    const model_path = String($('#live2d_model_select').val());

    if (model_path == 'none') {
        $('#live2d_model_settings').hide();
        delete extension_settings.live2d.characterModelMapping[character];
        saveSettingsDebounced();
        await removeModel(character);
        return;
    }

    extension_settings.live2d.characterModelMapping[character] = model_path;
    saveSettingsDebounced();

    await loadModelUi();
    await loadLive2d();
}

async function onModelScaleChange() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    extension_settings.live2d.characterModelsSettings[character][model_path]['scale'] = Number($('#live2d_model_scale').val());
    $('#live2d_model_scale_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['scale']);
    saveSettingsDebounced();
    rescaleModel(character);
}

async function onModelCoordChange() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    extension_settings.live2d.characterModelsSettings[character][model_path]['x'] = Number($('#live2d_model_x').val());
    extension_settings.live2d.characterModelsSettings[character][model_path]['y'] = Number($('#live2d_model_y').val());
    $('#live2d_model_x_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['x']);
    $('#live2d_model_y_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['y']);
    saveSettingsDebounced();
    moveModel(character, extension_settings.live2d.characterModelsSettings[character][model_path]['x'], extension_settings.live2d.characterModelsSettings[character][model_path]['y']);
}

async function onModelEyeOffsetChange() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    extension_settings.live2d.characterModelsSettings[character][model_path]['eye'] = Number($('#live2d_model_eye').val());
    $('#live2d_model_eye_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['eye']);
    saveSettingsDebounced();
}

async function onModelMouthChange() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    extension_settings.live2d.characterModelsSettings[character][model_path]['param_mouth_open_y_id'] = $('#live2d_model_param_mouth_open_y_select').val();

    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_open_speed'] = Number($('#live2d_model_mouth_open_speed').val());
    $('#live2d_model_mouth_open_speed_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_open_speed']);

    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_time_per_character'] = Number($('#live2d_model_mouth_time_per_character').val());
    $('#live2d_model_mouth_time_per_character_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_time_per_character']);

    saveSettingsDebounced();

    await loadLive2d();
    playTalk(character, TEST_MESSAGE);
}

async function onModelParamChange() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamAngleX'] = $('#live2d_model_param_angle_x_select').val();
    extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamAngleY'] = $('#live2d_model_param_angle_y_select').val();
    extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamAngleZ'] = $('#live2d_model_param_angle_z_select').val();
    extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamBodyAngleX'] = $('#live2d_model_param_body_angle_x_select').val();
    extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamBreath'] = $('#live2d_model_param_breath_select').val();
    extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamEyeBallX'] = $('#live2d_model_param_eye_x_select').val();
    extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param']['idParamEyeBallY'] = $('#live2d_model_param_eye_y_select').val();
    saveSettingsDebounced();

    await loadLive2d();
}

async function onModelParamResetClick(param_select_id, param_id) {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    var t;
    try{
        t = await live2d.Live2DModel.from(model_path, null, extension_settings.live2d.characterModelsSettings[character][model_path]['eye']||45)
    }catch{
        t = await live2d.Live2DModel.from(model_path)
    }
    const model = t;
    const model_parameter_ids = model.internalModel.coreModel._model?.parameters?.ids ?? [];
    // Free memory
    model.destroy(true, true, true);

    // Mouth param
    if (param_id == 'ParamMouthOpenY') {
        loadModelParamUi(character, model_path, model_parameter_ids, 'live2d_model_param_mouth_open_y_select', 'ParamMouthOpenY', false, true);
        return;
    }

    // Cursor param
    extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param'][param_id] = 'none';
    loadModelParamUi(character, model_path, model_parameter_ids, param_select_id, param_id, false, true);
    saveSettingsDebounced();
    await loadLive2d();
}

async function onModelParamDeleteClick(param_select_id, param_id) {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());

    // Mouth param
    if (param_id == 'ParamMouthOpenY') {
        extension_settings.live2d.characterModelsSettings[character][model_path]['param_mouth_open_y_id'] = 'none';
    }
    else {
        extension_settings.live2d.characterModelsSettings[character][model_path]['cursor_param'][param_id] = 'none';
    }

    $(`#${param_select_id}`).val('none');
    saveSettingsDebounced();
    await loadLive2d();
}

async function onAnimationMappingChange(type) {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    let expression;
    let motion;
    let message;

    switch (type) {
        case 'animation_starter':
            expression = $('#live2d_starter_expression_select').val();
            motion = $('#live2d_starter_motion_select').val();
            const delay = Number($('#live2d_starter_delay').val());

            $('#live2d_starter_delay_value').text(delay);

            extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter']['expression'] = expression;
            extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter']['motion'] = motion;
            extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter']['delay'] = delay;
            console.debug(DEBUG_PREFIX,'Updated animation_starter of',character,':',extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter']);
            break;

        case 'animation_default':
            expression = $('#live2d_default_expression_select').val();
            motion = $('#live2d_default_motion_select').val();

            extension_settings.live2d.characterModelsSettings[character][model_path]['animation_default']['expression'] = expression;
            extension_settings.live2d.characterModelsSettings[character][model_path]['animation_default']['motion'] = motion;
            console.debug(DEBUG_PREFIX,'Updated animation_default of',character,':',extension_settings.live2d.characterModelsSettings[character][model_path]['animation_default']);
            break;

        case 'animation_click':
            expression = $('#live2d_hit_area_default_expression_select').val();
            motion = $('#live2d_hit_area_default_motion_select').val();
            message = $('#live2d_hit_area_default_message').val();

            extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']['expression'] = expression;
            extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']['motion'] = motion;
            extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']['message'] = message;
            console.debug(DEBUG_PREFIX,'Updated animation_click of',character,':',extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']);
            break;

        default:
            console.error(DEBUG_PREFIX,'Unexpected type:',type);

    }

    saveSettingsDebounced();

    if (motion != 'none')
        await playMotion(character, motion, true);

    if (expression != 'none')
        await playExpression(character, expression);
}

async function loadModelUi() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    const expression_ui = $('#live2d_expression_mapping');
    const hit_areas_ui = $('#live2d_hit_areas_mapping');
    var t;
    try{
        t = await live2d.Live2DModel.from(model_path, null, extension_settings.live2d.characterModelsSettings[character][model_path]['eye']||45)
    }catch{
        t = await live2d.Live2DModel.from(model_path)
    }
    const model = t;

    expression_ui.empty();
    hit_areas_ui.empty();

    console.debug(DEBUG_PREFIX, 'loading settings of model:', model);

    let model_expressions = model.internalModel.settings.expressions;
    let model_motions = model.internalModel.settings.motions;
    let model_hit_areas = model.internalModel.hitAreas;
    let model_parameter_ids = model.internalModel.coreModel._model?.parameters?.ids ?? []; // Some model have it there
    let user_settings_exists = true;

    // Free memory
    model.destroy(true, true, true);

    // Default values
    if (model_expressions === undefined)
        model_expressions = [];

    if (model_motions === undefined)
        model_motions = {};

    if (model_hit_areas === undefined)
        model_hit_areas = {};

    if (model_parameter_ids === undefined)
        model_parameter_ids = [];

    model_expressions.sort();
    model_parameter_ids.sort();

    console.debug(DEBUG_PREFIX, 'expressions:', model_expressions);
    console.debug(DEBUG_PREFIX, 'motions:', model_motions);
    console.debug(DEBUG_PREFIX, 'hit areas:', model_hit_areas);
    console.debug(DEBUG_PREFIX, 'parameter ids:', model_parameter_ids);

    // Initialize new model
    if (extension_settings.live2d.characterModelsSettings[character] === undefined)
        extension_settings.live2d.characterModelsSettings[character] = {};

    if (extension_settings.live2d.characterModelsSettings[character][model_path] === undefined) {
        user_settings_exists = false;
        const default_scale = 1.0;
        extension_settings.live2d.characterModelsSettings[character][model_path] = {
            'scale': default_scale,
            'x': 0.0,
            'y': 0.0,
            'eye':45,
            'cursor_param': {
                'idParamAngleX' : 'none',
                'idParamAngleY' : 'none',
                'idParamAngleZ' : 'none',
                'idParamBodyAngleX' : 'none',
                'idParamBreath' : 'none',
                'idParamEyeBallX' : 'none',
                'idParamEyeBallY' : 'none',
            },
            'param_mouth_open_y_id': 'none',
            'mouth_open_speed': 1.0,
            'mouth_time_per_character': 30,
            'mouth_linked_params': {
                'param1': { 'paramId': '', 'minValue': 0, 'maxValue': 30 },
                'param2': { 'paramId': '', 'minValue': 0, 'maxValue': -15 },
                'param3': { 'paramId': '', 'minValue': 0, 'maxValue': 10 }
            },
            'eye_blink_params': {
                'left_eye': { 'paramId': '', 'minValue': 0, 'maxValue': 1 },
                'right_eye': { 'paramId': '', 'minValue': 0, 'maxValue': 1 }
            },
            'animation_starter': { 'expression': 'none', 'motion': 'none', 'delay': 0 },
            'animation_default': { 'expression': 'none', 'motion': 'none' },
            'animation_click': { 'expression': 'none', 'motion': 'none', 'message': '' },
            'hit_areas': {},
            'classify_mapping': {},
        };

        for (const expression of CLASSIFY_EXPRESSIONS) {
            extension_settings.live2d.characterModelsSettings[character][model_path]['classify_mapping'][expression] = { 'expression': 'none', 'motion': 'none' };
        }

        for (const area in model_hit_areas) {
            extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][area] = { 'expression': 'none', 'motion': 'none', 'message': '' };
        }

        // Check if model has default settings
        const model_settings_path = model_path.substring(0, model_path.lastIndexOf('/'))+"/sillytavern_settings.json"
        console.debug(DEBUG_PREFIX,"Checking if setting file exist in ",model_settings_path)
        try {
            const response = await fetch(model_settings_path);
            if (response.ok){
                const result = await response.json();
                console.debug(DEBUG_PREFIX,"File found");
                extension_settings.live2d.characterModelsSettings[character][model_path] = result;
            }
        } catch (error) {
            console.debug(DEBUG_PREFIX,"File not found, using default value");
        }
        console.debug(DEBUG_PREFIX,"Default settings:",extension_settings.live2d.characterModelsSettings[character][model_path])

        saveSettingsDebounced();
    }

    $('#live2d_model_scale').val(extension_settings.live2d.characterModelsSettings[character][model_path]['scale']);
    $('#live2d_model_scale_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['scale']);

    $('#live2d_model_x').val(extension_settings.live2d.characterModelsSettings[character][model_path]['x']);
    $('#live2d_model_x_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['x']);
    $('#live2d_model_y').val(extension_settings.live2d.characterModelsSettings[character][model_path]['y']);
    $('#live2d_model_y_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['y']);
    $('#live2d_model_eye').val(extension_settings.live2d.characterModelsSettings[character][model_path]['eye']);
    $('#live2d_model_eye_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['eye']);

    $('#live2d_model_mouth_open_speed').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_open_speed']);
    $('#live2d_model_mouth_open_speed_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_open_speed']);

    $('#live2d_model_mouth_time_per_character').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_time_per_character']);
    $('#live2d_model_mouth_time_per_character_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_time_per_character']);

    /*/ Param mouth open Y id candidates
  $("#live2d_model_param_mouth_open_y_select")
    .find('option')
    .remove()
    .end()
    .append('<option value="none">Select parameter id</option>');

  for (const i of model_parameter_ids) {
    $(`#live2d_model_param_mouth_open_y_select`).append(new Option(i, i));
  }

  // Default mouth open Y parameter detection
  if (!user_settings_exists && extension_settings.live2d.characterModelsSettings[character][model_path]["param_mouth_open_y_id"] == "none") {
    console.debug(DEBUG_PREFIX,"First time loading model for this character, searching for mouth open Y parameter")
    if (model_parameter_ids.includes(PARAM_MOUTH_OPEN_Y_DEFAULT)) {
      console.debug(DEBUG_PREFIX,"Found default parameter",PARAM_MOUTH_OPEN_Y_DEFAULT)
      extension_settings.live2d.characterModelsSettings[character][model_path]["param_mouth_open_y_id"] = PARAM_MOUTH_OPEN_Y_DEFAULT;
      saveSettingsDebounced();
    }
  }

  $("#live2d_model_param_mouth_open_y_select").val(extension_settings.live2d.characterModelsSettings[character][model_path]["param_mouth_open_y_id"]);*/

	// MouthAnimations
    loadModelParamUi(character, model_path, model_parameter_ids, 'live2d_model_param_mouth_open_y_select', 'ParamMouthOpenY', user_settings_exists);

    // Load mouth-linked parameters for this character and model
    if (extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']) {
        $('#live2d_mouth_linked_param_id_1').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param1']['paramId']);
        $('#live2d_mouth_linked_min_1').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param1']['minValue']);
        $('#live2d_mouth_linked_max_1').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param1']['maxValue']);
        
        $('#live2d_mouth_linked_param_id_2').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param2']['paramId']);
        $('#live2d_mouth_linked_min_2').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param2']['minValue']);
        $('#live2d_mouth_linked_max_2').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param2']['maxValue']);
        
        $('#live2d_mouth_linked_param_id_3').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param3']['paramId']);
        $('#live2d_mouth_linked_min_3').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param3']['minValue']);
        $('#live2d_mouth_linked_max_3').val(extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param3']['maxValue']);
    } else {
        // Initialize if not exists
        extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params'] = {
            'param1': { 'paramId': '', 'minValue': 0, 'maxValue': 30 },
            'param2': { 'paramId': '', 'minValue': 0, 'maxValue': -15 },
            'param3': { 'paramId': '', 'minValue': 0, 'maxValue': 10 }
        };
        saveSettingsDebounced();
        
        // Load defaults in UI
        $('#live2d_mouth_linked_param_id_1').val('');
        $('#live2d_mouth_linked_min_1').val(0);
        $('#live2d_mouth_linked_max_1').val(30);
        $('#live2d_mouth_linked_param_id_2').val('');
        $('#live2d_mouth_linked_min_2').val(0);
        $('#live2d_mouth_linked_max_2').val(-15);
        $('#live2d_mouth_linked_param_id_3').val('');
        $('#live2d_mouth_linked_min_3').val(0);
        $('#live2d_mouth_linked_max_3').val(10);
    }
    
    // Load eye blink parameters for this character and model
    if (extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']) {
        $('#live2d_left_eye_param_id').val(extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['left_eye']['paramId']);
        $('#live2d_left_eye_min').val(extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['left_eye']['minValue']);
        $('#live2d_left_eye_max').val(extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['left_eye']['maxValue']);
        
        $('#live2d_right_eye_param_id').val(extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['right_eye']['paramId']);
        $('#live2d_right_eye_min').val(extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['right_eye']['minValue']);
        $('#live2d_right_eye_max').val(extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['right_eye']['maxValue']);
    } else {
        // Initialize if not exists
        extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params'] = {
            'left_eye': { 'paramId': '', 'minValue': 0, 'maxValue': 1 },
            'right_eye': { 'paramId': '', 'minValue': 0, 'maxValue': 1 }
        };
        saveSettingsDebounced();
        
        // Load defaults in UI
        $('#live2d_left_eye_param_id').val('');
        $('#live2d_left_eye_min').val(0);
        $('#live2d_left_eye_max').val(1);
        $('#live2d_right_eye_param_id').val('');
        $('#live2d_right_eye_min').val(0);
        $('#live2d_right_eye_max').val(1);
    }

    // Mouse tracking parameters
    loadModelParamUi(character, model_path, model_parameter_ids, 'live2d_model_param_angle_x_select', 'idParamAngleX', user_settings_exists);
    loadModelParamUi(character, model_path, model_parameter_ids, 'live2d_model_param_angle_y_select', 'idParamAngleY', user_settings_exists);
    loadModelParamUi(character, model_path, model_parameter_ids, 'live2d_model_param_angle_z_select', 'idParamAngleZ', user_settings_exists);
    loadModelParamUi(character, model_path, model_parameter_ids, 'live2d_model_param_body_angle_x_select', 'idParamBodyAngleX', user_settings_exists);
    loadModelParamUi(character, model_path, model_parameter_ids, 'live2d_model_param_breath_select', 'idParamBreath', user_settings_exists);
    loadModelParamUi(character, model_path, model_parameter_ids, 'live2d_model_param_eye_x_select', 'idParamEyeBallX', user_settings_exists);
    loadModelParamUi(character, model_path, model_parameter_ids, 'live2d_model_param_eye_y_select', 'idParamEyeBallY', user_settings_exists);

    // Starter expression/motion
    loadAnimationUi(
        model_expressions,
        model_motions,
        'live2d_starter_expression_select',
        'live2d_starter_motion_select',
        extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter']['expression'],
        extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter']['motion']);
    $('#live2d_starter_delay').val(extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter']['delay']);
    $('#live2d_starter_delay_value').text(extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter']['delay']);

    // Default expression/motion
    loadAnimationUi(
        model_expressions,
        model_motions,
        'live2d_default_expression_select',
        'live2d_default_motion_select',
        extension_settings.live2d.characterModelsSettings[character][model_path]['animation_default']['expression'],
        extension_settings.live2d.characterModelsSettings[character][model_path]['animation_default']['motion']);

    // Default click animation
    loadAnimationUi(
        model_expressions,
        model_motions,
        'live2d_hit_area_default_expression_select',
        'live2d_hit_area_default_motion_select',
        extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']['expression'],
        extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']['motion']);
    $('#live2d_hit_area_default_message').val(extension_settings.live2d.characterModelsSettings[character][model_path]['animation_click']['message']);

    // Hit areas mapping
    for (const hit_area in model_hit_areas) {
        hit_areas_ui.append(`
    <div class="live2d-parameter">
        <div class="live2d-parameter-title">
            <label for="live2d_hit_area_${hit_area}">
              ${hit_area}
            </label>
        </div>
        <div>
            <div class="live2d-select-div">
                <select id="live2d_hit_area_expression_select_${hit_area}">
                </select>
                <div id="live2d_hit_area_expression_replay_${hit_area}" class="live2d_replay_button menu_button">
                    <i class="fa-solid fa-arrow-rotate-left"></i>
                </div>
            </div>
            <div class="live2d-select-div">
                <select id="live2d_hit_area_motion_select_${hit_area}">
                </select>
                <div id="live2d_hit_area_motion_replay_${hit_area}" class="live2d_replay_button menu_button">
                    <i class="fa-solid fa-arrow-rotate-left"></i>
                </div>
            </div>
            <textarea id="live2d_hit_area_message_${hit_area}" type="text" class="text_pole textarea_compact" rows="2"
        placeholder="Write message te send when clicking the area."></textarea>
        </div>
    </div>
    `);

        loadAnimationUi(
            model_expressions,
            model_motions,
            `live2d_hit_area_expression_select_${hit_area}`,
            `live2d_hit_area_motion_select_${hit_area}`,
            extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][hit_area]['expression'],
            extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][hit_area]['motion']);

        $(`#live2d_hit_area_message_${hit_area}`).val(extension_settings.live2d.characterModelsSettings[character][model_path]['hit_areas'][hit_area]['message']);

        $(`#live2d_hit_area_expression_select_${hit_area}`).on('change', function () { updateHitAreaMapping(hit_area); });
        $(`#live2d_hit_area_motion_select_${hit_area}`).on('change', function () { updateHitAreaMapping(hit_area); });
        $(`#live2d_hit_area_message_${hit_area}`).on('change', function () { updateHitAreaMapping(hit_area); });
        $(`#live2d_hit_area_expression_replay_${hit_area}`).on('click', function () { updateHitAreaMapping(hit_area); });
        $(`#live2d_hit_area_motion_replay_${hit_area}`).on('click', function () { updateHitAreaMapping(hit_area); });
    }

    // Classify expressions mapping
    for (const expression of CLASSIFY_EXPRESSIONS) {
        expression_ui.append(`
    <div class="live2d-parameter">
        <div class="live2d-parameter-title">
            <label for="live2d_expression_${expression}">
              ${expression}
            </label>
        </div>
        <div>
            <div class="live2d-select-div">
                <select id="live2d_expression_select_${expression}">
                </select>
                <div id="live2d_expression_replay_${expression}" class="live2d_replay_button menu_button">
                    <i class="fa-solid fa-arrow-rotate-left"></i>
                </div>
            </div>
            <div class="live2d-select-div">
                <select id="live2d_motion_select_${expression}">
                </select>
                <div id="live2d_motion_replay_${expression}" class="live2d_replay_button menu_button">
                    <i class="fa-solid fa-arrow-rotate-left"></i>
                </div>
            </div>
        </div>
    </div>
    `);

        loadAnimationUi(
            model_expressions,
            model_motions,
            `live2d_expression_select_${expression}`,
            `live2d_motion_select_${expression}`,
            extension_settings.live2d.characterModelsSettings[character][model_path]['classify_mapping'][expression]['expression'],
            extension_settings.live2d.characterModelsSettings[character][model_path]['classify_mapping'][expression]['motion']);

        $(`#live2d_expression_select_${expression}`).on('change', function () { updateExpressionMapping(expression); });
        $(`#live2d_motion_select_${expression}`).on('change', function () { updateExpressionMapping(expression); });
        $(`#live2d_expression_replay_${expression}`).on('click', function () { updateExpressionMapping(expression); });
        $(`#live2d_motion_replay_${expression}`).on('click', function () { updateExpressionMapping(expression); });
    }

    $('#live2d_model_settings').show();
}


async function updateHitAreaMapping(hitArea) {
    const character = String($('#live2d_character_select').val());
    const model = String($('#live2d_model_select').val());
    const model_expression = $(`#live2d_hit_area_expression_select_${hitArea}`).val();
    const model_motion = $(`#live2d_hit_area_motion_select_${hitArea}`).val();
    const message = $(`#live2d_hit_area_message_${hitArea}`).val();

    extension_settings.live2d.characterModelsSettings[character][model]['hit_areas'][hitArea] = { 'expression': model_expression, 'motion': model_motion, 'message': message };
    saveSettingsDebounced();

    console.debug(DEBUG_PREFIX, 'Updated hit area mapping:', hitArea, extension_settings.live2d.characterModelsSettings[character][model]['hit_areas'][hitArea]);

    // Play new setting
    if (model_motion != 'none')
        await playMotion(character, model_motion, true);
    if (model_expression != 'none')
        await playExpression(character, model_expression);
}

async function updateExpressionMapping(expression) {
    const character = String($('#live2d_character_select').val());
    const model = String($('#live2d_model_select').val());
    const model_expression = $(`#live2d_expression_select_${expression}`).val();
    const model_motion = $(`#live2d_motion_select_${expression}`).val();

    extension_settings.live2d.characterModelsSettings[character][model]['classify_mapping'][expression] = { 'expression': model_expression, 'motion': model_motion };
    saveSettingsDebounced();

    // Play new setting
    if (model_motion != 'none')
        await playMotion(character, model_motion, true);
    if (model_expression != 'none')
        await playExpression(character, model_expression);

    console.debug(DEBUG_PREFIX, 'Updated expression mapping:', expression, extension_settings.live2d.characterModelsSettings[character][model]['classify_mapping'][expression]);
}

function updateCharactersList() {
    let current_characters = new Set();
    const context = getContext();
    for (const i of context.characters) {
        current_characters.add(i.name);
    }

    current_characters = Array.from(current_characters);

    if (current_characters.length == 0)
        return;

    if (!extension_settings.live2d.showAllCharacters) {
        let chat_members = currentChatMembers();
        console.debug(DEBUG_PREFIX, 'Chat members', chat_members);

        // Sort group character on top
        for (const i of chat_members) {
            let index = current_characters.indexOf(i);
            if (index != -1) {
                console.debug(DEBUG_PREFIX, 'Moving to top', i);
                current_characters.splice(index, 1);
            }
        }

        current_characters = chat_members;
    }

    if (JSON.stringify(characters_list) !== JSON.stringify(current_characters)) {
        characters_list = current_characters;

        $('#live2d_character_select')
            .find('option')
            .remove()
            .end()
            .append('<option value="none">Select Character</option>')
            .val('none');

        for (const charName of characters_list) {
            $('#live2d_character_select').append(new Option(charName, charName));
        }

        console.debug(DEBUG_PREFIX, 'Updated character list to:', characters_list);
    }
}

async function updateCharactersModels(refreshButton = false) {
    const context = getContext();
    let chat_members = currentChatMembers();

    console.debug(DEBUG_PREFIX, 'Updating models mapping');

    // Assets folder models
    const assets = await getAssetsLive2dFiles();

    console.debug(DEBUG_PREFIX, 'Models from assets folder:',assets['live2d']);

    for (const character of chat_members) {
        if (refreshButton || characters_models[character] === undefined) {
            const local_models = await getCharacterLive2dFiles(character);
            characters_models[character] = [];
            for (const entry of local_models) {
                let label = entry.replace('assets\\live2d\\','').replaceAll('\\', '/');
                label = label.substring(0, label.lastIndexOf('/'));
                characters_models[character].push([label + ' (char folder)',entry]);
            }
            for (const entry of assets['live2d']) {
                let label = entry.replace('assets\\live2d\\','').replaceAll('\\', '/');
                label = label.substring(0, label.lastIndexOf('/'));
                characters_models[character].push([label + ' (assets folder)',entry]);
            }
            console.debug(DEBUG_PREFIX, 'Updated models of', character);
        }
    }

    console.debug(DEBUG_PREFIX, 'Updated models to:', characters_models);
    $('#live2d_character_select').trigger('change');
}

async function updateCharactersListOnce() {
    console.debug(DEBUG_PREFIX, 'UDPATING char list', characters_list);
    while (characters_list.length == 0) {
        console.debug(DEBUG_PREFIX, 'UDPATING char list');
        updateCharactersList();
        await delay(1000);
    }
}

//#############################//
//  API Calls                  //
//#############################//

async function getAssetsLive2dFiles() {
    console.debug(DEBUG_PREFIX, 'getting live2d model json file from assets folder');

    try {
        const result = await fetch('/api/assets/get', {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        let files = result.ok ? (await result.json()) : [];
        return files;
    }
    catch (err) {
        console.log(err);
        return [];
    }
}

async function getCharacterLive2dFiles(name) {
    console.debug(DEBUG_PREFIX, 'getting live2d model json file for', name);

    try {
        const result = await fetch(`/api/assets/character?name=${encodeURIComponent(name)}&category=${CHARACTER_LIVE2D_FOLDER}`, {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        let files = result.ok ? (await result.json()) : [];
        return files;
    }
    catch (err) {
        console.log(err);
        return [];
    }
}

async function playStarterAnimation() {
    const context = getContext();
    const group_id = context.groupId;
    let chat_members = currentChatMembers();
    let starting_delay = 0;

    console.debug(DEBUG_PREFIX,'Starting live2d first time');
    await loadLive2d(false);
    //await delay(300); // security to avoid model glitch

    console.debug(DEBUG_PREFIX,'Playing starters animation');
    for (const character of chat_members) {
        const model_path = extension_settings.live2d.characterModelMapping[character];

        if (model_path === undefined)
            continue;

        starting_delay = Math.max(starting_delay, extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter']['delay']);

        const starter_animation = extension_settings.live2d.characterModelsSettings[character][model_path]['animation_starter'];
        console.debug(DEBUG_PREFIX,'Playing starter animation of',character);

        if (starter_animation.motion != 'none')
            await playMotion(character, starter_animation.motion);
        if (starter_animation.expression != 'none')
            await playExpression(character,starter_animation.expression);
    }

    console.debug(DEBUG_PREFIX,'Waiting for max starter delay:',starting_delay);
    await delay(starting_delay);
    console.debug(DEBUG_PREFIX,'Make canvas visible');
    setVisible();
}

// Auto animations event handlers
async function onAutoAnimationsEnabledClick() {
    extension_settings.live2d.autoAnimationsEnabled = $('#live2d_auto_animations_enabled').is(':checked');
    saveSettingsDebounced();
    // Note: Use "Restart Animations" button to apply changes
}

async function onAutoEyeCenterWeightChange() {
    extension_settings.live2d.autoEyeCenterWeight = Number($('#live2d_auto_eye_center_weight').val()) / 100;
    $('#live2d_auto_eye_center_weight_value').text(Math.round(extension_settings.live2d.autoEyeCenterWeight * 100));
    saveSettingsDebounced();
}

async function onAutoEyeAmplitudeCenterChange() {
    extension_settings.live2d.autoEyeAmplitudeCenter = Number($('#live2d_auto_eye_amplitude_center').val());
    $('#live2d_auto_eye_amplitude_center_value').text(extension_settings.live2d.autoEyeAmplitudeCenter);
    saveSettingsDebounced();
}

async function onAutoEyeAmplitudePeripheralChange() {
    extension_settings.live2d.autoEyeAmplitudePeripheral = Number($('#live2d_auto_eye_amplitude_peripheral').val());
    $('#live2d_auto_eye_amplitude_peripheral_value').text(extension_settings.live2d.autoEyeAmplitudePeripheral);
    saveSettingsDebounced();
}

async function onAutoEyeFixationMinChange() {
    extension_settings.live2d.autoEyeFixationMin = Number($('#live2d_auto_eye_fixation_min').val());
    $('#live2d_auto_eye_fixation_min_value').text(extension_settings.live2d.autoEyeFixationMin);
    saveSettingsDebounced();
}

async function onAutoEyeFixationMaxChange() {
    extension_settings.live2d.autoEyeFixationMax = Number($('#live2d_auto_eye_fixation_max').val());
    $('#live2d_auto_eye_fixation_max_value').text(extension_settings.live2d.autoEyeFixationMax);
    saveSettingsDebounced();
}



// Microsaccades event handlers
async function onMicrosaccadesEnabledClick() {
    extension_settings.live2d.microsaccadesEnabled = $('#live2d_microsaccades_enabled').is(':checked');
    saveSettingsDebounced();
    // Note: Use "Restart Animations" button to apply changes
}

async function onMicrosaccadeAmplitudeChange() {
    extension_settings.live2d.microsaccadeAmplitude = Number($('#live2d_microsaccade_amplitude').val());
    $('#live2d_microsaccade_amplitude_value').text(extension_settings.live2d.microsaccadeAmplitude.toFixed(3));
    saveSettingsDebounced();
}

async function onMicrosaccadeFrequencyChange() {
    extension_settings.live2d.microsaccadeFrequency = Number($('#live2d_microsaccade_frequency').val());
    $('#live2d_microsaccade_frequency_value').text(extension_settings.live2d.microsaccadeFrequency);
    saveSettingsDebounced();
}

async function onMicrosaccadeDurationChange() {
    extension_settings.live2d.microsaccadeDuration = Number($('#live2d_microsaccade_duration').val());
    $('#live2d_microsaccade_duration_value').text(extension_settings.live2d.microsaccadeDuration);
    saveSettingsDebounced();
}

async function onMicrosaccadeIntervalMinChange() {
    extension_settings.live2d.microsaccadeIntervalMin = Number($('#live2d_microsaccade_interval_min').val());
    $('#live2d_microsaccade_interval_min_value').text(extension_settings.live2d.microsaccadeIntervalMin);
    saveSettingsDebounced();
}

async function onMicrosaccadeIntervalMaxChange() {
    extension_settings.live2d.microsaccadeIntervalMax = Number($('#live2d_microsaccade_interval_max').val());
    $('#live2d_microsaccade_interval_max_value').text(extension_settings.live2d.microsaccadeIntervalMax);
    saveSettingsDebounced();
}

async function onRestartAnimationsClick() {
    const { restartAutoAnimations, charactersWithModelLoaded } = await import('./live2d.js');
    const loadedCharacters = charactersWithModelLoaded();
    
    console.debug(DEBUG_PREFIX, 'Restarting animations for all loaded characters:', loadedCharacters);
    
    for (const character of loadedCharacters) {
        await restartAutoAnimations(character);
    }
    
    console.debug(DEBUG_PREFIX, 'All animations restarted with current settings');
}

// Custom parameter testing event handlers
async function onResetCustomParamClick() {
    // Reset custom parameter slider to 0
    $('#live2d_custom_param_value').val(0);
    $('#live2d_custom_param_value_display').text('0.0');
    
    // Apply to all loaded characters if parameter ID is set
    const paramId = $('#live2d_custom_param_id').val().trim();
    if (paramId) {
        const { setBodyParameter, charactersWithModelLoaded } = await import('./live2d.js');
        const loadedCharacters = charactersWithModelLoaded();
        
        for (const character of loadedCharacters) {
            await setBodyParameter(character, paramId, 0);
        }
        
        console.debug(DEBUG_PREFIX, `Reset custom parameter ${paramId} to 0`);
    }
}

async function onLogParametersClick() {
    const { logModelParameters, charactersWithModelLoaded } = await import('./live2d.js');
    const loadedCharacters = charactersWithModelLoaded();
    
    if (loadedCharacters.length === 0) {
        console.log(DEBUG_PREFIX, 'No characters with loaded models found');
        alert('No Live2D models loaded. Please load a model first.');
        return;
    }
    
    console.log(DEBUG_PREFIX, '=== MODEL PARAMETERS DEBUG ===');
    for (const character of loadedCharacters) {
        await logModelParameters(character);
    }
    console.log(DEBUG_PREFIX, '=== END DEBUG ===');
    
    alert('Parameters logged to console! Open Developer Tools (F12) and check the Console tab.');
}

async function onCustomParamChange() {
    const paramId = $('#live2d_custom_param_id').val().trim();
    const value = Number($('#live2d_custom_param_value').val());
    
    $('#live2d_custom_param_value_display').text(value.toFixed(1));
    
    if (!paramId) {
        console.debug(DEBUG_PREFIX, 'No parameter ID specified');
        return;
    }
    
    const { setBodyParameter, charactersWithModelLoaded } = await import('./live2d.js');
    const loadedCharacters = charactersWithModelLoaded();
    
    for (const character of loadedCharacters) {
        await setBodyParameter(character, paramId, value);
    }
}

async function onMouthLinkedParam1Change() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    
    if (character === 'none' || model_path === 'none') {
        return;
    }
    
    const paramId = $('#live2d_mouth_linked_param_id_1').val().trim();
    const minValue = Number($('#live2d_mouth_linked_min_1').val());
    const maxValue = Number($('#live2d_mouth_linked_max_1').val());
    
    // Сохраняем в настройки для конкретного персонажа и модели
    if (!extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']) {
        extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params'] = {
            'param1': { 'paramId': '', 'minValue': 0, 'maxValue': 30 },
            'param2': { 'paramId': '', 'minValue': 0, 'maxValue': -15 },
            'param3': { 'paramId': '', 'minValue': 0, 'maxValue': 10 }
        };
    }
    
    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param1']['paramId'] = paramId;
    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param1']['minValue'] = minValue;
    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param1']['maxValue'] = maxValue;
    saveSettingsDebounced();
    
    // Также обновляем в live2d.js для использования в функции playTalk
    const { updateMouthLinkedSettings } = await import('./live2d.js');
    await updateMouthLinkedSettings(0, paramId, minValue, maxValue); // Index 0 для первого параметра
    
    console.debug(DEBUG_PREFIX, `Updated mouth-linked parameter 1 for ${character}/${model_path}: ${paramId} (${minValue} to ${maxValue})`);
}

async function onMouthLinkedParam2Change() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    
    if (character === 'none' || model_path === 'none') {
        return;
    }
    
    const paramId = $('#live2d_mouth_linked_param_id_2').val().trim();
    const minValue = Number($('#live2d_mouth_linked_min_2').val());
    const maxValue = Number($('#live2d_mouth_linked_max_2').val());
    
    // Сохраняем в настройки для конкретного персонажа и модели
    if (!extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']) {
        extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params'] = {
            'param1': { 'paramId': '', 'minValue': 0, 'maxValue': 30 },
            'param2': { 'paramId': '', 'minValue': 0, 'maxValue': -15 },
            'param3': { 'paramId': '', 'minValue': 0, 'maxValue': 10 }
        };
    }
    
    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param2']['paramId'] = paramId;
    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param2']['minValue'] = minValue;
    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param2']['maxValue'] = maxValue;
    saveSettingsDebounced();
    
    // Также обновляем в live2d.js для использования в функции playTalk
    const { updateMouthLinkedSettings } = await import('./live2d.js');
    await updateMouthLinkedSettings(1, paramId, minValue, maxValue); // Index 1 для второго параметра
    
    console.debug(DEBUG_PREFIX, `Updated mouth-linked parameter 2 for ${character}/${model_path}: ${paramId} (${minValue} to ${maxValue})`);
}

async function onMouthLinkedParam3Change() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    
    if (character === 'none' || model_path === 'none') {
        return;
    }
    
    const paramId = $('#live2d_mouth_linked_param_id_3').val().trim();
    const minValue = Number($('#live2d_mouth_linked_min_3').val());
    const maxValue = Number($('#live2d_mouth_linked_max_3').val());
    
    // Сохраняем в настройки для конкретного персонажа и модели
    if (!extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']) {
        extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params'] = {
            'param1': { 'paramId': '', 'minValue': 0, 'maxValue': 30 },
            'param2': { 'paramId': '', 'minValue': 0, 'maxValue': -15 },
            'param3': { 'paramId': '', 'minValue': 0, 'maxValue': 10 }
        };
    }
    
    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param3']['paramId'] = paramId;
    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param3']['minValue'] = minValue;
    extension_settings.live2d.characterModelsSettings[character][model_path]['mouth_linked_params']['param3']['maxValue'] = maxValue;
    saveSettingsDebounced();
    
    // Также обновляем в live2d.js для использования в функции playTalk
    const { updateMouthLinkedSettings } = await import('./live2d.js');
    await updateMouthLinkedSettings(2, paramId, minValue, maxValue); // Index 2 для третьего параметра
    
    console.debug(DEBUG_PREFIX, `Updated mouth-linked parameter 3 for ${character}/${model_path}: ${paramId} (${minValue} to ${maxValue})`);
}

// Body movement system event handlers
async function onBodyMovementEnabledClick() {
    extension_settings.live2d.bodyMovementEnabled = $('#live2d_body_movement_enabled').is(':checked');
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement enabled:', extension_settings.live2d.bodyMovementEnabled);
}

async function onBodyMovementIdleIntensityChange() {
    extension_settings.live2d.bodyMovementIdleIntensity = parseFloat($('#live2d_body_movement_idle_intensity').val());
    $('#live2d_body_movement_idle_intensity_value').text(extension_settings.live2d.bodyMovementIdleIntensity.toFixed(2));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement idle intensity:', extension_settings.live2d.bodyMovementIdleIntensity);
}

async function onBodyMovementTalkingIntensityChange() {
    extension_settings.live2d.bodyMovementTalkingIntensity = parseFloat($('#live2d_body_movement_talking_intensity').val());
    $('#live2d_body_movement_talking_intensity_value').text(extension_settings.live2d.bodyMovementTalkingIntensity.toFixed(2));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement talking intensity:', extension_settings.live2d.bodyMovementTalkingIntensity);
}

async function onBodyMovementImpulseChanceChange() {
    extension_settings.live2d.bodyMovementImpulseChance = parseFloat($('#live2d_body_movement_impulse_chance').val());
    $('#live2d_body_movement_impulse_chance_value').text(extension_settings.live2d.bodyMovementImpulseChance.toFixed(1));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement impulse chance:', extension_settings.live2d.bodyMovementImpulseChance);
}

async function onBodyMovementTalkingImpulseFrequencyChange() {
    extension_settings.live2d.bodyMovementTalkingImpulseFrequency = parseFloat($('#live2d_body_movement_talking_impulse_frequency').val());
    $('#live2d_body_movement_talking_impulse_frequency_value').text(extension_settings.live2d.bodyMovementTalkingImpulseFrequency.toFixed(0));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement talking impulse frequency:', extension_settings.live2d.bodyMovementTalkingImpulseFrequency);
}

async function onBodyMovementTalkingImpulseMultiplierChange() {
    extension_settings.live2d.bodyMovementTalkingImpulseMultiplier = parseFloat($('#live2d_body_movement_talking_impulse_multiplier').val());
    $('#live2d_body_movement_talking_impulse_multiplier_value').text(extension_settings.live2d.bodyMovementTalkingImpulseMultiplier.toFixed(1));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement talking impulse multiplier:', extension_settings.live2d.bodyMovementTalkingImpulseMultiplier);
}

async function onBodyMovementTalkingSpeedBoostChange() {
    extension_settings.live2d.bodyMovementTalkingSpeedBoost = parseFloat($('#live2d_body_movement_talking_speed_boost').val());
    $('#live2d_body_movement_talking_speed_boost_value').text(extension_settings.live2d.bodyMovementTalkingSpeedBoost.toFixed(1));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement talking speed boost:', extension_settings.live2d.bodyMovementTalkingSpeedBoost);
}

async function onBodyMovementDampingChange() {
    extension_settings.live2d.bodyMovementDamping = parseFloat($('#live2d_body_movement_damping').val());
    $('#live2d_body_movement_damping_value').text(extension_settings.live2d.bodyMovementDamping.toFixed(2));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement damping:', extension_settings.live2d.bodyMovementDamping);
}

async function onBodyMovementSpringStiffnessChange() {
    extension_settings.live2d.bodyMovementSpringStiffness = parseFloat($('#live2d_body_movement_spring_stiffness').val());
    $('#live2d_body_movement_spring_stiffness_value').text(extension_settings.live2d.bodyMovementSpringStiffness.toFixed(2));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement spring stiffness:', extension_settings.live2d.bodyMovementSpringStiffness);
}

async function onBodyMovementImpulseInertiaChange() {
    extension_settings.live2d.bodyMovementImpulseInertia = parseFloat($('#live2d_body_movement_impulse_inertia').val());
    $('#live2d_body_movement_impulse_inertia_value').text(extension_settings.live2d.bodyMovementImpulseInertia.toFixed(2));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Body movement impulse inertia:', extension_settings.live2d.bodyMovementImpulseInertia);
}

async function onRestartBodyMovementClick() {
    const { restartBodyMovement, charactersWithModelLoaded, getModel } = await import('./live2d.js');
    const loadedCharacters = charactersWithModelLoaded();
    
    console.debug(DEBUG_PREFIX, 'Restarting body movement for all loaded characters:', loadedCharacters);
    
    for (const character of loadedCharacters) {
        const model_path = extension_settings.live2d.characterModelMapping[character];
        const model = getModel(character);
        
        if (model_path && model) {
            await restartBodyMovement(character, model, model_path);
        }
    }
    
    console.debug(DEBUG_PREFIX, 'All body movements restarted with current settings');
}

// Eye blink system event handlers
async function onEyeBlinkEnabledClick() {
    extension_settings.live2d.eyeBlinkEnabled = $('#live2d_eye_blink_enabled').is(':checked');
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Eye blink enabled:', extension_settings.live2d.eyeBlinkEnabled);
}

async function onEyeBlinkSpeedChange() {
    extension_settings.live2d.eyeBlinkSpeed = parseFloat($('#live2d_eye_blink_speed').val());
    $('#live2d_eye_blink_speed_value').text(extension_settings.live2d.eyeBlinkSpeed.toFixed(1));
    saveSettingsDebounced();
    console.debug(DEBUG_PREFIX, 'Eye blink speed:', extension_settings.live2d.eyeBlinkSpeed);
}

async function onLeftEyeParamChange() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    
    if (character === 'none' || model_path === 'none') {
        return;
    }
    
    const paramId = $('#live2d_left_eye_param_id').val().trim();
    const minValue = Number($('#live2d_left_eye_min').val());
    const maxValue = Number($('#live2d_left_eye_max').val());
    
    console.debug(DEBUG_PREFIX, `Left eye param change - Raw values: paramId="${paramId}", min="${$('#live2d_left_eye_min').val()}", max="${$('#live2d_left_eye_max').val()}"`);
    console.debug(DEBUG_PREFIX, `Left eye param change - Parsed values: paramId="${paramId}", minValue=${minValue}, maxValue=${maxValue}`);
    
    // Сохраняем в настройки для конкретного персонажа и модели
    if (!extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']) {
        extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params'] = {
            'left_eye': { 'paramId': '', 'minValue': 0, 'maxValue': 1 },
            'right_eye': { 'paramId': '', 'minValue': 0, 'maxValue': 1 }
        };
    }
    
    extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['left_eye']['paramId'] = paramId;
    extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['left_eye']['minValue'] = minValue;
    extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['left_eye']['maxValue'] = maxValue;
    saveSettingsDebounced();
    
    console.debug(DEBUG_PREFIX, `Updated left eye parameter for ${character}/${model_path}: ${paramId} (min=${minValue} [open], max=${maxValue} [closed])`);
}

async function onRightEyeParamChange() {
    const character = String($('#live2d_character_select').val());
    const model_path = String($('#live2d_model_select').val());
    
    if (character === 'none' || model_path === 'none') {
        return;
    }
    
    const paramId = $('#live2d_right_eye_param_id').val().trim();
    const minValue = Number($('#live2d_right_eye_min').val());
    const maxValue = Number($('#live2d_right_eye_max').val());
    
    // Сохраняем в настройки для конкретного персонажа и модели
    if (!extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']) {
        extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params'] = {
            'left_eye': { 'paramId': '', 'minValue': 0, 'maxValue': 1 },
            'right_eye': { 'paramId': '', 'minValue': 0, 'maxValue': 1 }
        };
    }
    
    extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['right_eye']['paramId'] = paramId;
    extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['right_eye']['minValue'] = minValue;
    extension_settings.live2d.characterModelsSettings[character][model_path]['eye_blink_params']['right_eye']['maxValue'] = maxValue;
    saveSettingsDebounced();
    
    console.debug(DEBUG_PREFIX, `Updated right eye parameter for ${character}/${model_path}: ${paramId} (${minValue} to ${maxValue})`);
}

async function onRestartEyeBlinkClick() {
    const { restartEyeBlink, charactersWithModelLoaded, getModel } = await import('./live2d.js');
    const loadedCharacters = charactersWithModelLoaded();
    
    console.debug(DEBUG_PREFIX, 'Restarting eye blink for all loaded characters:', loadedCharacters);
    
    for (const character of loadedCharacters) {
        const model_path = extension_settings.live2d.characterModelMapping[character];
        const model = getModel(character);
        
        if (model_path && model) {
            await restartEyeBlink(character, model, model_path);
        }
    }
    
    console.debug(DEBUG_PREFIX, 'All eye blink systems restarted with current settings');
}
