(() => {
  'use strict';

  const nativeSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isFirefox = /Firefox\//i.test(navigator.userAgent || '');
  if (nativeSpeechRecognition && !isFirefox) return;

  const MAX_RECORDING_MS = 20000;
  const TRANSCRIPTION_TIMEOUT_MS = 25000;
  const TRANSCRIPTION_URL = '/api/transcribe';
  const MIME_TYPES = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm',
    'audio/ogg'
  ];

  const copy = {
    en: {
      idle: 'Voice command',
      recording: 'Recording — press again to send',
      transcribing: 'Transcribing voice…',
      denied: 'Microphone permission was not granted. Allow microphone access and try again.',
      unsupported: 'Voice input is not supported by this browser or device.',
      empty: 'No clear speech was detected. Please try again.',
      failed: 'Voice transcription is temporarily unavailable. Please type your question.'
    },
    el: {
      idle: 'Φωνητική εντολή',
      recording: 'Ηχογράφηση — πατήστε ξανά για αποστολή',
      transcribing: 'Μεταγραφή φωνής…',
      denied: 'Δεν δόθηκε άδεια μικροφώνου. Επιτρέψτε την πρόσβαση και δοκιμάστε ξανά.',
      unsupported: 'Η φωνητική εισαγωγή δεν υποστηρίζεται από αυτό το πρόγραμμα ή τη συσκευή.',
      empty: 'Δεν εντοπίστηκε καθαρή ομιλία. Δοκιμάστε ξανά.',
      failed: 'Η μεταγραφή φωνής δεν είναι προσωρινά διαθέσιμη. Γράψτε την ερώτησή σας.'
    },
    fr: {
      idle: 'Commande vocale', recording: 'Enregistrement — appuyez à nouveau pour envoyer',
      transcribing: 'Transcription…', denied: "L’accès au microphone n’a pas été autorisé.",
      unsupported: "La saisie vocale n’est pas prise en charge.", empty: 'Aucune parole claire détectée.',
      failed: 'La transcription vocale est temporairement indisponible.'
    },
    de: {
      idle: 'Sprachbefehl', recording: 'Aufnahme — zum Senden erneut drücken',
      transcribing: 'Sprache wird transkribiert…', denied: 'Der Mikrofonzugriff wurde nicht erlaubt.',
      unsupported: 'Spracheingabe wird nicht unterstützt.', empty: 'Keine deutliche Sprache erkannt.',
      failed: 'Die Sprachtranskription ist vorübergehend nicht verfügbar.'
    },
    es: {
      idle: 'Comando de voz', recording: 'Grabando — pulsa de nuevo para enviar',
      transcribing: 'Transcribiendo voz…', denied: 'No se concedió permiso para usar el micrófono.',
      unsupported: 'La entrada de voz no es compatible.', empty: 'No se detectó voz clara.',
      failed: 'La transcripción de voz no está disponible temporalmente.'
    },
    it: {
      idle: 'Comando vocale', recording: 'Registrazione — premi di nuovo per inviare',
      transcribing: 'Trascrizione vocale…', denied: 'Il permesso per il microfono non è stato concesso.',
      unsupported: "L’input vocale non è supportato.", empty: 'Non è stata rilevata una voce chiara.',
      failed: 'La trascrizione vocale non è temporaneamente disponibile.'
    },
    ro: {
      idle: 'Comandă vocală', recording: 'Înregistrare — apăsați din nou pentru trimitere',
      transcribing: 'Transcriere voce…', denied: 'Permisiunea pentru microfon nu a fost acordată.',
      unsupported: 'Introducerea vocală nu este acceptată.', empty: 'Nu a fost detectată vorbire clară.',
      failed: 'Transcrierea vocală este temporar indisponibilă.'
    },
    zh: {
      idle: '语音输入', recording: '正在录音—再次点击即可发送', transcribing: '正在转写语音…',
      denied: '未授予麦克风权限。', unsupported: '此浏览器或设备不支持语音输入。',
      empty: '未检测到清晰语音。', failed: '语音转写暂时不可用。'
    },
    ja: {
      idle: '音声入力', recording: '録音中—もう一度押すと送信', transcribing: '音声を文字に変換中…',
      denied: 'マイクの使用が許可されていません。', unsupported: 'このブラウザでは音声入力を利用できません。',
      empty: '明瞭な音声を検出できませんでした。', failed: '音声文字起こしは一時的に利用できません。'
    },
    ru: {
      idle: 'Голосовой ввод', recording: 'Запись — нажмите ещё раз для отправки',
      transcribing: 'Распознавание речи…', denied: 'Доступ к микрофону не предоставлен.',
      unsupported: 'Голосовой ввод не поддерживается.', empty: 'Чёткая речь не обнаружена.',
      failed: 'Распознавание речи временно недоступно.'
    }
  };

  let voiceButton;
  let chatInput;
  let sendButton;
  let recorder = null;
  let mediaStream = null;
  let chunks = [];
  let stopTimer = null;
  let state = 'idle';

  function language() {
    const value = document.getElementById('lang-select')?.value || 'en';
    return Object.hasOwn(copy, value) ? value : 'en';
  }

  function words() {
    return copy[language()] || copy.en;
  }

  function announce(message) {
    const status = document.getElementById('voice-compat-status');
    if (status) status.textContent = message;
  }

  function updateButton(nextState) {
    state = nextState;
    const text = words();
    voiceButton.disabled = nextState === 'requesting' || nextState === 'transcribing';
    voiceButton.setAttribute('aria-pressed', nextState === 'recording' ? 'true' : 'false');

    if (nextState === 'recording') {
      voiceButton.textContent = '■';
      voiceButton.title = text.recording;
      voiceButton.setAttribute('aria-label', text.recording);
      voiceButton.style.backgroundColor = '#dc2626';
      voiceButton.style.color = '#ffffff';
      voiceButton.style.boxShadow = '0 0 0 4px rgba(220, 38, 38, 0.18)';
      announce(text.recording);
      return;
    }

    if (nextState === 'requesting' || nextState === 'transcribing') {
      voiceButton.textContent = '…';
      voiceButton.title = text.transcribing;
      voiceButton.setAttribute('aria-label', text.transcribing);
      voiceButton.style.backgroundColor = '#e2e8f0';
      voiceButton.style.color = '#475569';
      voiceButton.style.boxShadow = '';
      announce(text.transcribing);
      return;
    }

    voiceButton.textContent = '🎤';
    voiceButton.title = text.idle;
    voiceButton.setAttribute('aria-label', text.idle);
    voiceButton.style.backgroundColor = '';
    voiceButton.style.color = '';
    voiceButton.style.boxShadow = '';
    announce('');
  }

  function stopTracks() {
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) track.stop();
    }
    mediaStream = null;
  }

  function selectedMimeType() {
    if (typeof MediaRecorder.isTypeSupported !== 'function') return '';
    return MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || '';
  }

  function fileExtension(mimeType) {
    return mimeType.includes('ogg') ? 'ogg' : 'webm';
  }

  async function transcribe(blob) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);
    const form = new FormData();
    form.append('audio', blob, `voice.${fileExtension(blob.type)}`);
    form.append('lang', language());

    try {
      const response = await fetch(TRANSCRIPTION_URL, {
        method: 'POST',
        body: form,
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.text !== 'string') {
        throw new Error(data.error || `Transcription failed (${response.status})`);
      }
      return data.text.trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function finishRecording() {
    clearTimeout(stopTimer);
    stopTimer = null;
    stopTracks();
    updateButton('transcribing');

    try {
      const mimeType = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
      const audio = new Blob(chunks, { type: mimeType });
      chunks = [];
      recorder = null;

      if (audio.size < 128) {
        alert(words().empty);
        return;
      }

      const text = await transcribe(audio);
      if (!text) {
        alert(words().empty);
        return;
      }

      chatInput.value = text;
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
      sendButton.click();
    } catch (error) {
      console.error('Voice transcription failed', error);
      alert(words().failed);
    } finally {
      updateButton('idle');
      chatInput.focus();
    }
  }

  function stopRecording() {
    if (recorder?.state === 'recording') recorder.stop();
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert(words().unsupported);
      return;
    }

    updateButton('requesting');
    try {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        });
      } catch (error) {
        if (error?.name !== 'OverconstrainedError') throw error;
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      chunks = [];
      const mimeType = selectedMimeType();
      try {
        recorder = mimeType
          ? new MediaRecorder(mediaStream, { mimeType, audioBitsPerSecond: 64000 })
          : new MediaRecorder(mediaStream);
      } catch {
        recorder = new MediaRecorder(mediaStream);
      }

      recorder.addEventListener('dataavailable', event => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => void finishRecording(), { once: true });
      recorder.addEventListener('error', () => stopRecording(), { once: true });
      recorder.start(250);
      updateButton('recording');
      stopTimer = setTimeout(stopRecording, MAX_RECORDING_MS);
    } catch (error) {
      console.error('Microphone access failed', error);
      stopTracks();
      updateButton('idle');
      alert(error?.name === 'NotAllowedError' ? words().denied : words().failed);
    }
  }

  function handleVoiceClick(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle') {
      void startRecording();
    }
  }

  function initialize() {
    voiceButton = document.getElementById('voice-btn');
    chatInput = document.getElementById('chat-input');
    sendButton = document.getElementById('send-btn');
    if (!voiceButton || !chatInput || !sendButton) return;

    const status = document.createElement('span');
    status.id = 'voice-compat-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';
    voiceButton.insertAdjacentElement('afterend', status);

    voiceButton.addEventListener('click', handleVoiceClick, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state === 'recording') stopRecording();
    });
    window.addEventListener('beforeunload', stopTracks);
    updateButton('idle');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
