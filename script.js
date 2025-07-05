const playSampleBtn = document.getElementById('playSample');
const startRecBtn = document.getElementById('startRec');
const stopRecBtn = document.getElementById('stopRec');
const playRecBtn = document.getElementById('playRec');
const exportBtn = document.getElementById('export');
const saveBtn = document.getElementById('saveSound');
const savedList = document.getElementById('savedList');
const trimStartInput = document.getElementById('trimStart');
const trimEndInput = document.getElementById('trimEnd');
const canvas = document.getElementById('spectrogram');
const canvasCtx = canvas.getContext('2d');

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 512;

let spectData = new Uint8Array(analyser.frequencyBinCount);
let mediaRecorder = null;
let chunks = [];
let recordedBlob = null;

let historyFrames = [];
let isCapturing = false;
let viewOffset = 0;
let viewWidth = 200; // number of frames visible
let selectedFrame = 0;
let isDragging = false;
let dragStartX = 0;
const FRAME_DURATION = 1 / 60;
let currentAudio = null;

function drawSpectrogram() {
    requestAnimationFrame(drawSpectrogram);
    analyser.getByteFrequencyData(spectData);

    if (isCapturing) {
        historyFrames.push(Array.from(spectData));
        viewWidth = Math.min(historyFrames.length, viewWidth);
    }

    const width = canvas.width;
    const height = canvas.height;
    canvasCtx.clearRect(0, 0, width, height);
    const step = viewWidth / width;
    for (let x = 0; x < width; x++) {
        const frameIdx = Math.floor(viewOffset + x * step);
        const frame = historyFrames[frameIdx];
        if (!frame) continue;
        for (let i = 0; i < frame.length; i++) {
            const value = frame[i];
            const percent = value / 255;
            const hue = 240 - (240 * percent);
            canvasCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;
            canvasCtx.fillRect(x, height - i, 1, 1);
        }
    }
    if (selectedFrame >= viewOffset && selectedFrame <= viewOffset + viewWidth) {
        const posX = Math.floor((selectedFrame - viewOffset) / viewWidth * width);
        canvasCtx.strokeStyle = 'red';
        canvasCtx.beginPath();
        canvasCtx.moveTo(posX, 0);
        canvasCtx.lineTo(posX, height);
        canvasCtx.stroke();
    }
}

drawSpectrogram();

canvas.addEventListener('mousedown', e => {
    isDragging = true;
    dragStartX = e.offsetX;
});

canvas.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.offsetX - dragStartX;
    dragStartX = e.offsetX;
    viewOffset -= dx / canvas.width * viewWidth;
    viewOffset = Math.max(0, Math.min(historyFrames.length - viewWidth, viewOffset));
});

window.addEventListener('mouseup', () => { isDragging = false; });

canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const zoom = e.deltaY < 0 ? 0.9 : 1.1;
    const newWidth = viewWidth * zoom;
    if (newWidth >= 10 && newWidth <= historyFrames.length) {
        viewWidth = newWidth;
        viewOffset = Math.max(0, Math.min(historyFrames.length - viewWidth, viewOffset));
    }
});

canvas.addEventListener('click', e => {
    if (e.ctrlKey) {
        selectedFrame = Math.floor(viewOffset + e.offsetX / canvas.width * viewWidth);
    }
});

playSampleBtn.onclick = () => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.5;
    osc.frequency.value = 440;
    osc.connect(gain);
    gain.connect(analyser);
    gain.connect(audioCtx.destination);
    isCapturing = true;
    osc.start();
    osc.stop(audioCtx.currentTime + 2);
    osc.onended = () => { isCapturing = false; };
};

startRecBtn.onclick = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
        recordedBlob = new Blob(chunks, { type: 'audio/webm' });
        chunks = [];
        playRecBtn.disabled = false;
        exportBtn.disabled = false;
        saveBtn.disabled = false;
        const buf = await audioCtx.decodeAudioData(await recordedBlob.arrayBuffer());
        trimEndInput.value = buf.duration.toFixed(2);
    };
    mediaRecorder.start();
    startRecBtn.disabled = true;
    stopRecBtn.disabled = false;
    playRecBtn.disabled = true;
    exportBtn.disabled = true;
    saveBtn.disabled = true;
    historyFrames = [];
    viewOffset = 0;
    selectedFrame = 0;
    isCapturing = true;
};

stopRecBtn.onclick = () => {
    if (mediaRecorder) mediaRecorder.stop();
    startRecBtn.disabled = false;
    stopRecBtn.disabled = true;
    isCapturing = false;
};

playRecBtn.onclick = () => {
    togglePlay();
};

function bufferToWave(buffer, len) {
    const numOfChan = buffer.numberOfChannels;
    const length = len * numOfChan * 2 + 44;
    const wavBuffer = new ArrayBuffer(length);
    const view = new DataView(wavBuffer);
    let offset = 0;

    const writeString = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset++, s.charCodeAt(i)); };
    const writeUint32 = (d) => { view.setUint32(offset, d, true); offset += 4; };
    const writeUint16 = (d) => { view.setUint16(offset, d, true); offset += 2; };

    writeString('RIFF');
    writeUint32(length - 8);
    writeString('WAVE');
    writeString('fmt ');
    writeUint32(16);
    writeUint16(1);
    writeUint16(numOfChan);
    writeUint32(buffer.sampleRate);
    writeUint32(buffer.sampleRate * numOfChan * 2);
    writeUint16(numOfChan * 2);
    writeUint16(16);
    writeString('data');
    writeUint32(length - 44);

    const channels = [];
    for (let i = 0; i < numOfChan; i++) {
        channels.push(buffer.getChannelData(i));
    }

    for (let i = 0; i < len; i++) {
        for (let ch = 0; ch < numOfChan; ch++) {
            let sample = Math.max(-1, Math.min(1, channels[ch][i]));
            sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, sample, true);
            offset += 2;
        }
    }

    return new Blob([view], { type: 'audio/wav' });
}

exportBtn.onclick = async () => {
    if (!recordedBlob) return;
    const arrayBuffer = await recordedBlob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    let start = parseFloat(trimStartInput.value) || 0;
    let end = parseFloat(trimEndInput.value);
    if (!end || end > decoded.duration) end = decoded.duration;
    start = Math.max(0, Math.min(start, decoded.duration));
    end = Math.max(start, Math.min(end, decoded.duration));
    const length = Math.floor((end - start) * decoded.sampleRate);
    const trimmed = audioCtx.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const channel = decoded.getChannelData(ch).subarray(Math.floor(start * decoded.sampleRate), Math.floor(end * decoded.sampleRate));
        trimmed.copyToChannel(channel, ch, 0);
    }
    const wav = bufferToWave(trimmed, length);
    const url = URL.createObjectURL(wav);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recording.wav';
    a.click();
};

async function getTrimmedBlob() {
    const arrayBuffer = await recordedBlob.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    let start = parseFloat(trimStartInput.value) || 0;
    let end = parseFloat(trimEndInput.value);
    if (!end || end > decoded.duration) end = decoded.duration;
    start = Math.max(0, Math.min(start, decoded.duration));
    end = Math.max(start, Math.min(end, decoded.duration));
    const length = Math.floor((end - start) * decoded.sampleRate);
    const trimmed = audioCtx.createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const channel = decoded.getChannelData(ch).subarray(Math.floor(start * decoded.sampleRate), Math.floor(end * decoded.sampleRate));
        trimmed.copyToChannel(channel, ch, 0);
    }
    return bufferToWave(trimmed, length);
}

saveBtn.onclick = async () => {
    if (!recordedBlob) return;
    const name = prompt('Save sound as:');
    if (!name) return;
    const wav = await getTrimmedBlob();
    const reader = new FileReader();
    reader.onloadend = () => {
        const sounds = JSON.parse(localStorage.getItem('sounds') || '[]');
        sounds.push({name, data: reader.result});
        localStorage.setItem('sounds', JSON.stringify(sounds));
        updateSavedList();
    };
    reader.readAsDataURL(wav);
};

function updateSavedList() {
    const sounds = JSON.parse(localStorage.getItem('sounds') || '[]');
    savedList.innerHTML = '';
    sounds.forEach((s, idx) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.textContent = s.name;
        btn.onclick = () => loadSound(idx);
        li.appendChild(btn);
        savedList.appendChild(li);
    });
}

async function loadSound(idx) {
    const sounds = JSON.parse(localStorage.getItem('sounds') || '[]');
    const dataUrl = sounds[idx].data;
    const res = await fetch(dataUrl);
    const buffer = await res.arrayBuffer();
    recordedBlob = new Blob([buffer], {type: 'audio/wav'});
    playRecBtn.disabled = false;
    exportBtn.disabled = false;
    saveBtn.disabled = false;
    const buf = await audioCtx.decodeAudioData(buffer.slice(0));
    trimStartInput.value = 0;
    trimEndInput.value = buf.duration.toFixed(2);
    historyFrames = [];
    viewOffset = 0;
    selectedFrame = 0;
}

function togglePlay() {
    if (!recordedBlob) return;
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        isCapturing = false;
        return;
    }
    const url = URL.createObjectURL(recordedBlob);
    const audio = new Audio(url);
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    source.connect(audioCtx.destination);
    audio.currentTime = selectedFrame * FRAME_DURATION;
    audio.onended = () => {
        source.disconnect();
        currentAudio = null;
        isCapturing = false;
    };
    currentAudio = audio;
    isCapturing = true;
    audio.play();
}

document.addEventListener('keydown', e => {
    if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
    }
});

updateSavedList();
