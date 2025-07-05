const playSampleBtn = document.getElementById('playSample');
const startRecBtn = document.getElementById('startRec');
const stopRecBtn = document.getElementById('stopRec');
const playRecBtn = document.getElementById('playRec');
const exportBtn = document.getElementById('export');
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

function drawSpectrogram() {
    requestAnimationFrame(drawSpectrogram);
    analyser.getByteFrequencyData(spectData);

    // shift canvas
    const width = canvas.width;
    const height = canvas.height;
    const imageData = canvasCtx.getImageData(1, 0, width - 1, height);
    canvasCtx.putImageData(imageData, 0, 0);

    for (let i = 0; i < spectData.length; i++) {
        const value = spectData[i];
        const percent = value / 255;
        const hue = 240 - (240 * percent);
        canvasCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        canvasCtx.fillRect(width - 1, height - i, 1, 1);
    }
}

drawSpectrogram();

playSampleBtn.onclick = () => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.5;
    osc.frequency.value = 440;
    osc.connect(gain);
    gain.connect(analyser);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 2);
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
        const buf = await audioCtx.decodeAudioData(await recordedBlob.arrayBuffer());
        trimEndInput.value = buf.duration.toFixed(2);
    };
    mediaRecorder.start();
    startRecBtn.disabled = true;
    stopRecBtn.disabled = false;
};

stopRecBtn.onclick = () => {
    if (mediaRecorder) mediaRecorder.stop();
    startRecBtn.disabled = false;
    stopRecBtn.disabled = true;
};

playRecBtn.onclick = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const audio = new Audio(url);
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    source.connect(audioCtx.destination);
    audio.onended = () => {
        source.disconnect();
    };
    audio.play();
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
