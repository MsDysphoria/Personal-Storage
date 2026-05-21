(function () {
if (window.__DysphoriaLevelVideoPlayerTwoBufferLoaded) {
if (window.DysphoriaLevelVideoPlayer && window.DysphoriaLevelVideoPlayer.init) {
window.DysphoriaLevelVideoPlayer.init();
}
return;
}

window.__DysphoriaLevelVideoPlayerTwoBufferLoaded = true;
window.__DysphoriaLevelVideoPlayerLoaded = true;

var defaultOrder = ["sunrise", "day", "cloudy", "sunset", "night"];

function toArray(list) {
return Array.prototype.slice.call(list || []);
}

function unique(list) {
var used = {};
return list.filter(function (item) {
if (!item || used[item]) return false;
used[item] = true;
return true;
});
}

function clamp01(value) {
return Math.max(0, Math.min(1, value));
}

function wait(ms) {
return new Promise(function (resolve) {
setTimeout(resolve, ms);
});
}

function getCssNumber(root, name, fallback) {
var value = getComputedStyle(root).getPropertyValue(name).trim();
var parsed = parseFloat(value);
return Number.isFinite(parsed) ? parsed : fallback;
}

function getCssTimeMs(root, name, fallback) {
var value = getComputedStyle(root).getPropertyValue(name).trim();

if (value.indexOf("ms") !== -1) return parseFloat(value) || fallback;
if (value.indexOf("s") !== -1) return (parseFloat(value) || fallback / 1000) * 1000;

return parseFloat(value) || fallback;
}

function waitForVideoEvent(video, eventNames, timeout) {
if (!video) return Promise.resolve();

return new Promise(function (resolve) {
var done = false;
var timer = null;

function finish() {
if (done) return;
done = true;

if (timer) clearTimeout(timer);

eventNames.forEach(function (name) {
video.removeEventListener(name, finish);
});

resolve();
}

eventNames.forEach(function (name) {
video.addEventListener(name, finish, { once: true });
});

timer = setTimeout(finish, timeout);
});
}

function waitForMetadata(video, timeout) {
if (!video || video.readyState >= 1) return Promise.resolve();
return waitForVideoEvent(video, ["loadedmetadata", "loadeddata", "canplay"], timeout);
}

function waitForFrame(video, timeout) {
if (!video || video.readyState >= 2) return Promise.resolve();
return waitForVideoEvent(video, ["loadeddata", "canplay", "canplaythrough", "timeupdate"], timeout);
}

function playSafely(video, timeout) {
if (!video) return Promise.resolve();

try {
var promise = video.play();

if (promise && promise.then) {
return Promise.race([
promise.catch(function () {}),
wait(timeout)
]).then(function () {
return waitForFrame(video, timeout);
});
}
} catch (error) {}

return waitForFrame(video, timeout);
}

function seekSafely(video, targetTime, timeout) {
if (!video) return Promise.resolve();

return waitForMetadata(video, timeout).then(function () {
return new Promise(function (resolve) {
var done = false;
var timer = null;

function finish() {
if (done) return;
done = true;

if (timer) clearTimeout(timer);

video.removeEventListener("seeked", finish);
video.removeEventListener("loadeddata", finish);
video.removeEventListener("canplay", finish);

resolve();
}

try {
if (Math.abs((video.currentTime || 0) - targetTime) < 0.04) {
finish();
return;
}

video.addEventListener("seeked", finish, { once: true });
video.addEventListener("loadeddata", finish, { once: true });
video.addEventListener("canplay", finish, { once: true });

video.currentTime = targetTime;
} catch (error) {
finish();
return;
}

timer = setTimeout(finish, timeout);
});
});
}

function getEnvOrder(root, buttons) {
var attr = root.getAttribute("data-env-order");

if (attr) {
return unique(attr.split(",").map(function (item) {
return item.trim();
}));
}

var buttonOrder = buttons.map(function (button) {
return button.getAttribute("data-env");
});

return unique(buttonOrder.length ? buttonOrder : defaultOrder);
}

function getSources(root, envOrder) {
var sources = {};

envOrder.forEach(function (env) {
var src = root.getAttribute("data-src-" + env);

if (src) {
sources[env] = src;
}
});

return sources;
}

function updateSliderFill(root, volumeSlider) {
var min = parseFloat(volumeSlider.min || "0");
var max = parseFloat(volumeSlider.max || "1");
var value = parseFloat(volumeSlider.value || "0");
var percent = 0;

if (max > min) {
percent = ((value - min) / (max - min)) * 100;
}

volumeSlider.style.setProperty("--dlvp-volume-fill-percent", percent + "%");
root.style.setProperty("--dlvp-volume-fill-percent", percent + "%");
}

function initRoot(root) {
if (!root || root.dataset.dlvpTwoBufferReady === "true") return false;

var frame = root.querySelector(".dlvp-video-frame");
var buttons = toArray(root.querySelectorAll(".dlvp-env-button"));
var volumeSlider = root.querySelector(".dlvp-volume");

if (!frame || !buttons.length || !volumeSlider) return false;

root.dataset.dlvpTwoBufferReady = "true";
root.dataset.dlvpReady = "true";

frame.querySelectorAll(".dlvp-env-layer, .dlvp-video").forEach(function (element) {
element.remove();
});

var envOrder = getEnvOrder(root, buttons);
var sources = getSources(root, envOrder);

envOrder = envOrder.filter(function (env) {
return !!sources[env];
});

if (!envOrder.length) {
root.dataset.dlvpTwoBufferReady = "false";
root.dataset.dlvpReady = "false";
return false;
}

var activeButton = root.querySelector(".dlvp-env-button.dlvp-active");
var currentEnv = root.getAttribute("data-initial-env") || (activeButton ? activeButton.getAttribute("data-env") : "") || envOrder[0];

if (!sources[currentEnv]) {
currentEnv = envOrder[0];
}

var envStates = {};
var currentState = null;
var currentVolume = parseFloat(volumeSlider.value || "0") || 0;
var viewportAudioGain = 1;

var transitionLocked = false;
var cooldownTimer = null;
var environmentAudioFrame = null;
var viewportAudioFrame = null;
var isVisible = true;

function getPrepareTimeout() {
return getCssTimeMs(root, "--dlvp-transition-prepare-timeout", 1200);
}

function getCrossfadeTime() {
return getCssTimeMs(root, "--dlvp-crossfade-time", 1650);
}

function getLoopSwapLead() {
return getCssNumber(root, "--dlvp-loop-swap-lead", 0.12);
}

function getVisibilityAudioFadeTime() {
return getCssTimeMs(root, "--dlvp-visibility-audio-fade-time", 550);
}

function setButtonState(env) {
buttons.forEach(function (button) {
button.classList.toggle("dlvp-active", button.getAttribute("data-env") === env);
});
}

function lockControls() {
transitionLocked = true;
root.classList.add("dlvp-cooldown");

buttons.forEach(function (button) {
button.disabled = true;
});
}

function unlockControlsAfter(startTime, minimumDuration) {
var elapsed = performance.now() - startTime;
var remaining = Math.max(0, minimumDuration - elapsed);

if (cooldownTimer) {
clearTimeout(cooldownTimer);
cooldownTimer = null;
}

cooldownTimer = setTimeout(function () {
transitionLocked = false;
root.classList.remove("dlvp-cooldown");

buttons.forEach(function (button) {
if (button.style.display !== "none") {
button.disabled = false;
}
});
}, remaining);
}

function setMediaVolume(video, value) {
if (!video) return;

var volume = clamp01(value);

try {
video.volume = volume;
video.muted = volume <= 0;
} catch (error) {}
}

function applyStateVolumes(state) {
if (!state) return;

state.videos.forEach(function (video, index) {
setMediaVolume(video, currentVolume * viewportAudioGain * state.audioGain * state.mix[index]);
});
}

function applyAllVolumes() {
Object.keys(envStates).forEach(function (env) {
applyStateVolumes(envStates[env]);
});
}

function fadeViewportAudio(targetGain, pauseAfter) {
if (viewportAudioFrame) {
cancelAnimationFrame(viewportAudioFrame);
viewportAudioFrame = null;
}

var startGain = viewportAudioGain;
var duration = getVisibilityAudioFadeTime();
var start = performance.now();

function step(now) {
var t = clamp01((now - start) / duration);
var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

viewportAudioGain = startGain + ((targetGain - startGain) * eased);
applyAllVolumes();

if (t < 1) {
viewportAudioFrame = requestAnimationFrame(step);
} else {
viewportAudioGain = targetGain;
applyAllVolumes();
viewportAudioFrame = null;

if (pauseAfter) {
Object.keys(envStates).forEach(function (env) {
envStates[env].videos.forEach(function (video) {
try {
video.pause();
} catch (error) {}
});
});
}
}
}

viewportAudioFrame = requestAnimationFrame(step);
}

function styleLayer(layer) {
layer.style.position = "absolute";
layer.style.inset = "0";
layer.style.width = "100%";
layer.style.height = "100%";
layer.style.opacity = "0";
layer.style.zIndex = "1";
layer.style.pointerEvents = "none";
layer.style.transition = "none";
}

function setVideoVisible(video, visible, zIndex) {
video.style.opacity = visible ? "1" : "0";
video.style.zIndex = String(zIndex || 1);
video.style.transition = "none";
video.classList.toggle("dlvp-visible", !!visible);
}

function prepareVideo(video, env) {
video.className = "dlvp-video dlvp-video-" + env;
video.src = sources[env];
video.preload = "auto";
video.autoplay = true;
video.loop = false;
video.controls = false;
video.playsInline = true;
video.muted = true;
video.volume = 0;

video.setAttribute("playsinline", "");
video.setAttribute("muted", "");
video.removeAttribute("controls");

setVideoVisible(video, false, 1);

video.load();
}

function createState(env) {
var layer = document.createElement("div");
var videoA = document.createElement("video");
var videoB = document.createElement("video");

layer.className = "dlvp-env-layer dlvp-env-layer-" + env;
styleLayer(layer);

prepareVideo(videoA, env);
prepareVideo(videoB, env);

layer.appendChild(videoA);
layer.appendChild(videoB);
frame.appendChild(layer);

var state = {
env: env,
layer: layer,
videos: [videoA, videoB],
activeIndex: 0,
mix: [1, 0],
audioGain: 0,
started: false,
looping: false,
loopFrame: null
};

videoA.addEventListener("ended", function () {
if (state.started && state.activeIndex === 0 && !state.looping) {
beginHardLoop(state);
}
});

videoB.addEventListener("ended", function () {
if (state.started && state.activeIndex === 1 && !state.looping) {
beginHardLoop(state);
}
});

return state;
}

function stopLoopMonitor(state) {
if (!state) return;

if (state.loopFrame) {
cancelAnimationFrame(state.loopFrame);
state.loopFrame = null;
}
}

function pauseState(state, reset) {
if (!state) return;

stopLoopMonitor(state);

state.started = false;
state.looping = false;
state.audioGain = 0;
state.mix = [0, 0];

state.layer.style.opacity = "0";
state.layer.style.zIndex = "1";
state.layer.style.transition = "none";

state.videos.forEach(function (video) {
try {
video.pause();

if (reset) {
video.currentTime = 0;
}
} catch (error) {}

setMediaVolume(video, 0);
setVideoVisible(video, false, 1);
});
}

function playVisibleStateVideos(state) {
if (!state || !state.started || !isVisible || document.visibilityState !== "visible") return;

state.videos.forEach(function (video, index) {
if (state.mix[index] > 0) {
playSafely(video, getPrepareTimeout());
}
});
}

function playAllVisibleVideos() {
Object.keys(envStates).forEach(function (env) {
playVisibleStateVideos(envStates[env]);
});
}

function hardSwapLoopVideos(state, oldIndex, newIndex) {
var oldVideo = state.videos[oldIndex];
var newVideo = state.videos[newIndex];

state.activeIndex = newIndex;
state.mix[oldIndex] = 0;
state.mix[newIndex] = 1;

setVideoVisible(newVideo, true, 2);
setVideoVisible(oldVideo, false, 1);

applyStateVolumes(state);

try {
oldVideo.pause();
oldVideo.currentTime = 0;
} catch (error) {}

state.looping = false;
}

function beginHardLoop(state) {
if (!state || !state.started || state.looping) return;

var oldIndex = state.activeIndex;
var newIndex = oldIndex === 0 ? 1 : 0;
var newVideo = state.videos[newIndex];
var timeout = getPrepareTimeout();

state.looping = true;

state.mix[newIndex] = 0;
setMediaVolume(newVideo, 0);
setVideoVisible(newVideo, false, 1);

seekSafely(newVideo, 0, timeout).then(function () {
if (!state.started) return Promise.resolve();

return playSafely(newVideo, timeout);
}).then(function () {
if (!state.started) return Promise.resolve();

return waitForFrame(newVideo, timeout);
}).then(function () {
if (!state.started) {
state.looping = false;
return;
}

hardSwapLoopVideos(state, oldIndex, newIndex);
});
}

function startLoopMonitor(state) {
if (!state) return;

stopLoopMonitor(state);

function tick() {
if (!state.started) return;

if (!state.looping) {
try {
var activeVideo = state.videos[state.activeIndex];
var duration = activeVideo.duration;
var time = activeVideo.currentTime;

if (Number.isFinite(duration) && duration > 0) {
var lead = getLoopSwapLead();
var threshold = Math.max(0.05, duration - lead);

if (time >= threshold) {
beginHardLoop(state);
}
}
} catch (error) {}
}

state.loopFrame = requestAnimationFrame(tick);
}

state.loopFrame = requestAnimationFrame(tick);
}

function startState(state, restart) {
if (!state) return Promise.resolve();

var timeout = getPrepareTimeout();
var activeVideo = state.videos[0];
var standbyVideo = state.videos[1];

stopLoopMonitor(state);

state.started = true;
state.looping = false;
state.activeIndex = 0;
state.mix = [1, 0];

setVideoVisible(activeVideo, true, 2);
setVideoVisible(standbyVideo, false, 1);

if (restart) {
try {
activeVideo.pause();
standbyVideo.pause();
activeVideo.currentTime = 0;
standbyVideo.currentTime = 0;
} catch (error) {}
}

applyStateVolumes(state);

return seekSafely(activeVideo, 0, timeout).then(function () {
if (!state.started) return Promise.resolve();

return playSafely(activeVideo, timeout);
}).then(function () {
if (!state.started) return Promise.resolve();

return waitForFrame(activeVideo, timeout);
}).then(function () {
if (!state.started) return;

startLoopMonitor(state);
});
}

function fadeEnvironmentAudio(fromState, toState, duration) {
if (environmentAudioFrame) {
cancelAnimationFrame(environmentAudioFrame);
environmentAudioFrame = null;
}

var start = performance.now();

function step(now) {
var t = clamp01((now - start) / duration);
var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

if (fromState) {
fromState.audioGain = 1 - eased;
applyStateVolumes(fromState);
}

if (toState) {
toState.audioGain = eased;
applyStateVolumes(toState);
}

if (t < 1) {
environmentAudioFrame = requestAnimationFrame(step);
} else {
if (fromState) {
fromState.audioGain = 0;
applyStateVolumes(fromState);
}

if (toState) {
toState.audioGain = 1;
applyStateVolumes(toState);
}

environmentAudioFrame = null;
}
}

environmentAudioFrame = requestAnimationFrame(step);
}

function fadeEnvironmentVisual(fromState, toState, duration, onDone) {
if (toState) {
toState.layer.style.transition = "none";
toState.layer.style.opacity = "1";
toState.layer.style.zIndex = "2";
}

if (fromState) {
fromState.layer.style.transition = "none";
fromState.layer.style.opacity = "1";
fromState.layer.style.zIndex = "3";

fromState.layer.offsetHeight;

fromState.layer.style.transition = "opacity " + duration + "ms linear";

requestAnimationFrame(function () {
fromState.layer.style.opacity = "0";
});
}

setTimeout(function () {
if (fromState) {
fromState.layer.style.transition = "none";
fromState.layer.style.opacity = "0";
fromState.layer.style.zIndex = "1";
}

if (toState) {
toState.layer.style.transition = "none";
toState.layer.style.opacity = "1";
toState.layer.style.zIndex = "2";
}

if (onDone) onDone();
}, duration + 100);
}

function switchEnvironment(env) {
if (!sources[env] || transitionLocked) return;
if (currentState && currentState.env === env) return;

var lockStart = performance.now();
var duration = getCrossfadeTime();
var minimumCooldown = getCssTimeMs(root, "--dlvp-button-cooldown", duration);
var fromState = currentState;
var toState = envStates[env];

lockControls();
setButtonState(env);

toState.audioGain = 0;
toState.layer.style.opacity = "0";
toState.layer.style.zIndex = "2";
applyStateVolumes(toState);

startState(toState, true).then(function () {
if (!toState) return;

currentEnv = env;
currentState = toState;

fadeEnvironmentVisual(fromState, toState, duration, function () {
if (fromState && fromState !== toState) {
pauseState(fromState, true);
}

toState.audioGain = 1;
applyStateVolumes(toState);

unlockControlsAfter(lockStart, minimumCooldown);
});

fadeEnvironmentAudio(fromState, toState, duration);
});
}

function setInitialEnvironment(env) {
var state = envStates[env];

currentEnv = env;
currentState = state;

state.audioGain = 1;
state.layer.style.opacity = "1";
state.layer.style.zIndex = "2";

setButtonState(env);

startState(state, true).then(function () {
state.audioGain = 1;
applyStateVolumes(state);
});
}

envOrder.forEach(function (env) {
envStates[env] = createState(env);
});

buttons.forEach(function (button) {
var env = button.getAttribute("data-env");

if (!sources[env]) {
button.disabled = true;
button.style.display = "none";
return;
}

button.addEventListener("click", function () {
switchEnvironment(env);
});
});

volumeSlider.addEventListener("input", function () {
currentVolume = parseFloat(volumeSlider.value) || 0;
updateSliderFill(root, volumeSlider);
applyAllVolumes();
playAllVisibleVideos();
});

document.addEventListener("visibilitychange", function () {
if (document.visibilityState === "visible") {
isVisible = true;
playAllVisibleVideos();
fadeViewportAudio(1, false);
} else {
isVisible = false;
fadeViewportAudio(0, true);
}
});

if ("IntersectionObserver" in window) {
var observer = new IntersectionObserver(function (entries) {
entries.forEach(function (entry) {
if (entry.target !== root) return;

if (entry.isIntersecting && entry.intersectionRatio > 0.1) {
isVisible = true;
playAllVisibleVideos();
fadeViewportAudio(1, false);
} else {
isVisible = false;
fadeViewportAudio(0, true);
}
});
}, {
threshold: [0, 0.1, 0.25, 0.5, 1]
});

observer.observe(root);
}

updateSliderFill(root, volumeSlider);
setInitialEnvironment(currentEnv);

return true;
}

function initAll() {
toArray(document.querySelectorAll(".dysphoria-level-video-player")).forEach(function (root) {
initRoot(root);
});
}

window.DysphoriaLevelVideoPlayer = {
init: initAll,
initOne: initRoot
};

function scheduleInit() {
initAll();

setTimeout(initAll, 100);
setTimeout(initAll, 500);
setTimeout(initAll, 1200);
setTimeout(initAll, 2500);
}

if (document.readyState === "loading") {
document.addEventListener("DOMContentLoaded", scheduleInit);
} else {
scheduleInit();
}

window.addEventListener("load", scheduleInit);

if ("MutationObserver" in window) {
var mutationObserver = new MutationObserver(function () {
initAll();
});

mutationObserver.observe(document.documentElement, {
childList: true,
subtree: true
});
}
})();