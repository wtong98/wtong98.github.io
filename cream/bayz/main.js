/**
 * Logic for controlling browser-side audio production with webaudio.
 * Producing bayz requires the bayz band live coding interface. For more
 * information, see https://github.com/wtong98/bayz.
 * 
 * @author William Tong
 */

let audioCtx;

let servOn = false;
const pollDelay = 1000;
const tickDelay = 1000;
const bayzServer = 'http://localhost:42700';

const nameToKernel = {
    sine: sineKernel,
    bell: bellKernel,
    warble: warbleKernel
}

const globalState = {
    current: undefined,
    proposed: undefined,
    ticker: Infinity,
}

const body = document.getElementsByTagName('body')[0];
const startButton = document.getElementById('start');
startButton.addEventListener('click', function(event){
    if (audioCtx == undefined) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)
    }

    if (servOn) {
        servOn = false;
        audioCtx.suspend()

        startButton.style.backgroundColor = "white";
        startButton.style.color = "black";
        startButton.innerHTML = "start"
        body.style.animation = "";
    } else {
        servOn = true;
        audioCtx.resume()

        startButton.style.backgroundColor = "#24464f";
        startButton.style.color = "white";
        startButton.innerHTML = "stop"
        body.style.animation = "vibe 4s infinite";

        tick();
        poll(bayzServer);
    }
})

function tick() {
    globalState.ticker--;
    console.log('ticker', globalState.ticker);
    if (globalState.ticker == 0 || globalState.ticker == Infinity) {
        if (globalState.proposed != undefined) {
            globalState.current = globalState.proposed;
            globalState.proposed = undefined;
        }

        if (globalState.current != undefined) {
            globalState.ticker = globalState.current.cycleLength;
            globalState.current.blocks.map((b) => b.play(audioCtx.currentTime));
        }
    }

    if (servOn) {
        setTimeout(tick, tickDelay);
    }
}

function poll(srvAddress) {
    axios.get(srvAddress).then((resp) => consumeResp(resp.data));
    if (servOn) {
        setTimeout(poll, pollDelay, srvAddress);
    }
}

function consumeResp(respData) {
    console.log('recieve resp', respData);
    if (respData.deploy) {
        const cyc = respData.cycleLength;
        blocks = respData.sound.map((tag) => makeBlock(tag, cyc));
        proposeBlocks(blocks, cyc);
    }
}

function makeBlock(tag, cycleLength) {
    const opts = nameToKernel[tag.name]();
    const instrument = makeInstrument(...opts);
    instrument.start();

    return {
        instrument: instrument,

        play(cursor) {
            const duration = computeDuration(tag.notes, tag.rhythm);
            const unit = cycleLength / duration;

            tag.notes.map(function(note, i) {
                const len = tag.rhythm.length;
                const stopTime = cursor + tag.rhythm[i % len] * unit;

                instrument.play(note, cursor, stopTime - 0.01);
                cursor = stopTime;
            });
        }
    }
}

function computeDuration(notes, rhythm) {
    const len = rhythm.length;
    total = notes.reduce(function(acc, _, i){
        return acc + rhythm[i % len];
    }, 0);

    return total;
}

function proposeBlocks(blocks, cycleLength) {
    const proposal = {
        blocks: blocks,
        cycleLength: cycleLength
    }

    globalState.proposed = proposal;
}



///////////////////////
///// INSTRUMENTS /////
///////////////////////

function makeInstrument(osc, gain, attack=0.01, sustain=0.1, decay=0.03) {
    return {
        osc: osc,
        gain: gain,

        start() {
            gain.gain.value = 0;
            gain.connect(audioCtx.destination);
            osc.start();
        },

        stop() {
            gain.gain.setTargetAtTime(0, audioCtx.currentTime, decay);
        },

        cleanup() {
            setTimeout(()=>osc.stop(), 100);
        },

        play(note, startTime=audioCtx.currentTime, stopTime=audioCtx.currentTime + 1) {
            osc.frequency.setValueAtTime(midiToFreq(note), startTime, stopTime);
            gain.gain.setTargetAtTime(sustain, startTime, attack);
            gain.gain.setTargetAtTime(0, stopTime, decay);
        }

    }
}

function sineKernel() {
    osc = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();
    osc.connect(gainNode);

    return [osc, gainNode];
}


function bellKernel() {
    const partials = [1, 2, 2.5, 3, 4, 5.3, 6.6, 8]
    const oscs = partials.map(() => audioCtx.createOscillator());

    const bellOsc = {
        oscs: oscs,
        start() {
            oscs.map((o)=>o.start());
        },

        stop() {
            oscs.map((o)=>o.stop());
        },

        frequency: {
            setValueAtTime(freq, start, stop) {
                oscs.map((o, i)=>o.frequency.setValueAtTime(freq * partials[i], start, stop));
            }
        }
    }

    const gainNode = audioCtx.createGain();
    bellOsc.oscs.map((o)=>o.connect(gainNode));

    return [bellOsc, gainNode, 0.01, 0.01];
}

function warbleKernel() {
    const carrier = audioCtx.createOscillator();
    const mod = audioCtx.createOscillator();

    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0;

    const modIdx = audioCtx.createGain();
    modIdx.gain.value = 25;
    mod.frequency.value = 15;

    mod.connect(modIdx).connect(carrier.frequency);
    carrier.connect(gainNode);

    const warbleOsc = {
        start() {
            mod.start();
            carrier.start();
        },

        stop() {
            mod.stop();
            carrier.stop();
        },

        frequency: {
            setValueAtTime(freq, start, stop) {
                carrier.frequency.setValueAtTime(freq, start, stop);
            }
        }
    }

    return [warbleOsc, gainNode];
}

function midiToFreq(m) {
    return Math.pow(2, (m - 69) / 12) * 440;
}