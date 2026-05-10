/**
 * processor.ts — Offscreen document that orchestrates FFmpeg preview generation.
 *
 * FFmpeg's @ffmpeg/core is compiled with Emscripten and uses new Function() in
 * its JS glue code.  Chrome MV3 forbids 'unsafe-eval' in extension_pages CSP,
 * so we cannot run FFmpeg directly here.
 *
 * Solution: we load a sandboxed extension page (sandbox.html) as a hidden iframe.
 * Sandboxed pages are exempt from the extension's CSP — they can freely use
 * new Function() / eval().  We communicate with the sandbox exclusively via
 * window.postMessage, passing data as transferable ArrayBuffers.
 *
 * Protocol (→ sandbox, ← sandbox):
 *   → { type:'vc_init',    id, jsBytes, wasmBytes }  (clone, not transfer)
 *   ← { type:'vc_sandbox_result', id, bytes:null }   (FFmpeg ready)
 *   → { type:'vc_process', id, videoBytes, duration } (transfer videoBytes)
 *   ← { type:'vc_sandbox_result', id, bytes }        (transfer result)
 *   ← { type:'vc_sandbox_result', id, error }        (on failure)
 */
import browser from 'webextension-polyfill';
import { savePreview } from '../lib/vault-client';
let _sandboxIframe = null;
let _ffmpegCoreBytes = null;
let _sandboxReady = false;
let _initPromise = null;
const _pending = new Map();
window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'vc_sandbox_result')
        return;
    const entry = _pending.get(msg.id);
    if (!entry)
        return;
    _pending.delete(msg.id);
    if (msg.error)
        entry.reject(new Error(msg.error));
    else
        entry.resolve(msg.bytes ?? null);
});
function createSandboxIframe() {
    return new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.src = browser.runtime.getURL('src/offscreen/sandbox.html');
        iframe.style.cssText = 'position:absolute;width:0;height:0;border:0';
        document.body.appendChild(iframe);
        iframe.addEventListener('load', () => {
            _sandboxIframe = iframe;
            resolve(iframe);
        }, { once: true });
    });
}
async function initSandbox() {
    const iframe = await createSandboxIframe();
    // Fetch FFmpeg core files (only once per offscreen document lifetime).
    if (!_ffmpegCoreBytes) {
        const [js, wasm] = await Promise.all([
            fetch(browser.runtime.getURL('ffmpeg-core/ffmpeg-core.js')).then(r => r.arrayBuffer()),
            fetch(browser.runtime.getURL('ffmpeg-core/ffmpeg-core.wasm')).then(r => r.arrayBuffer()),
        ]);
        _ffmpegCoreBytes = { js, wasm };
    }
    // Send init message.  Do NOT transfer the buffers — processor must keep
    // its copy so it can re-initialize a new sandbox if the iframe is torn down.
    await new Promise((resolve, reject) => {
        const id = '_init_' + Date.now();
        const timeoutId = setTimeout(() => {
            _pending.delete(id);
            reject(new Error('[VaultProcessor] Sandbox init timed out'));
        }, 60_000);
        _pending.set(id, {
            resolve: () => { clearTimeout(timeoutId); _sandboxReady = true; resolve(); },
            reject: (e) => { clearTimeout(timeoutId); reject(e); },
        });
        iframe.contentWindow.postMessage({ type: 'vc_init', id, jsBytes: _ffmpegCoreBytes.js, wasmBytes: _ffmpegCoreBytes.wasm }, '*');
    });
}
/**
 * Returns a ready sandbox iframe, initialising it exactly once even under
 * concurrent callers.
 */
async function ensureSandbox() {
    if (_sandboxReady && _sandboxIframe && document.body.contains(_sandboxIframe)) {
        return _sandboxIframe;
    }
    // Reset ready flag if iframe disappeared (e.g., offscreen doc recycled).
    _sandboxReady = false;
    if (!_initPromise) {
        _initPromise = initSandbox().catch((e) => {
            // Allow retry on next call.
            _initPromise = null;
            throw e;
        });
    }
    await _initPromise;
    return _sandboxIframe;
}
// ────────────────────────────────────────────────────────────
// Video processing
// ────────────────────────────────────────────────────────────
async function processVideoPreview(mediaUrl, duration) {
    const iframe = await ensureSandbox();
    // Fetch the video bytes here (offscreen document benefits from <all_urls>
    // host_permissions and can bypass CORS; the sandbox's null-origin cannot).
    const videoBytes = await fetch(mediaUrl).then(r => r.arrayBuffer());
    return new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);
        const timeoutId = setTimeout(() => {
            _pending.delete(id);
            reject(new Error('[VaultProcessor] Sandbox processing timed out'));
        }, 180_000);
        _pending.set(id, {
            resolve: (bytes) => {
                clearTimeout(timeoutId);
                resolve(bytes ? new Blob([bytes], { type: 'video/webm' }) : null);
            },
            reject: (e) => { clearTimeout(timeoutId); reject(e); },
        });
        // Transfer ownership of videoBytes to sandbox (zero-copy).
        iframe.contentWindow.postMessage({ type: 'vc_process', id, videoBytes, duration }, '*', [videoBytes]);
    });
}
// ────────────────────────────────────────────────────────────
// Runtime message handler (called by background.ts)
// ────────────────────────────────────────────────────────────
browser.runtime.onMessage.addListener((message) => {
    if (message.action !== 'generate_preview_process')
        return undefined;
    return handleGeneratePreviewProcess(message);
});
async function handleGeneratePreviewProcess(message) {
    const { previewKey, sourceUrl, url, duration } = message.data;
    const mediaUrl = sourceUrl || url;
    const storageKey = previewKey || url || sourceUrl;
    if (!mediaUrl || !storageKey) {
        return { success: false, error: 'Missing preview source URL or storage key' };
    }
    try {
        const blob = await processVideoPreview(mediaUrl, typeof duration === 'number' ? duration : 60);
        if (blob) {
            await savePreview(storageKey, blob);
            return { success: true };
        }
        return { success: false, error: 'Preview generation returned no blob' };
    }
    catch (err) {
        console.error('[VaultProcessor] Preview generation failed:', err);
        return { success: false, error: 'Preview generation failed' };
    }
}
