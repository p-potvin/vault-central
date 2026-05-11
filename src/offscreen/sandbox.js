/**
 * sandbox.ts — Sandboxed extension page for FFmpeg WASM processing.
 *
 * This file runs inside a sandboxed extension page (declared in manifest.json
 * under "sandbox.pages").  Sandboxed pages are exempt from the extension's
 * content_security_policy, so Emscripten's new Function() / eval() calls work
 * without requiring 'unsafe-eval' in the extension_pages CSP.
 *
 * This file has NO access to browser.* / chrome.* APIs.
 * All communication is via window.postMessage with the parent offscreen document.
 *
 * Message protocol (from parent processor):
 *   vc_init    { id, jsBytes: ArrayBuffer, wasmBytes: ArrayBuffer }
 *              → vc_sandbox_result { id, bytes: null }   (on success)
 *              → vc_sandbox_result { id, error: string } (on failure)
 *
 *   vc_process { id, videoBytes: ArrayBuffer, duration: number }
 *              → vc_sandbox_result { id, bytes: ArrayBuffer, transfer }
 *              → vc_sandbox_result { id, error: string }
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';
let ffmpeg = null;
console.log("[VaultSandbox] Sandbox scripts loaded.");
window.addEventListener('message', async (event) => {
    const msg = event.data;
    if (!msg?.type)
        return;
    console.log("[VaultSandbox] Received message:", msg.type);
    const src = event.source;
    const reply = (payload, transfer) => {
        if (transfer?.length) {
            src?.postMessage(payload, '*', transfer);
        }
        else {
            src?.postMessage(payload, '*');
        }
    };
    if (msg.type === 'vc_init') {
        const { id, jsBytes, wasmBytes } = msg;
        try {
            ffmpeg = new FFmpeg();
            // Create blob URLs from bytes passed by the parent.
            // These blobs live in the sandbox's null-origin context, so FFmpeg's
            // internal new Worker(coreURL) call succeeds without CSP issues.
            const coreBlob = new Blob([jsBytes], { type: 'text/javascript' });
            const wasmBlob = new Blob([wasmBytes], { type: 'application/wasm' });
            const workerBlob = new Blob([`importScripts('${URL.createObjectURL(coreBlob)}');`], { type: 'text/javascript' });
            await ffmpeg.load({
                coreURL: URL.createObjectURL(coreBlob),
                wasmURL: URL.createObjectURL(wasmBlob),
                classWorkerURL: URL.createObjectURL(workerBlob)
            });
            reply({ type: 'vc_sandbox_result', id, bytes: null });
        }
        catch (e) {
            console.error('[VaultSandbox] FFmpeg init failed:', e);
            reply({ type: 'vc_sandbox_result', id, error: e?.message ?? String(e) });
        }
        return;
    }
    if (msg.type === 'vc_process') {
        const { id, videoBytes, duration } = msg;
        if (!ffmpeg) {
            reply({ type: 'vc_sandbox_result', id, error: 'FFmpeg not initialized' });
            return;
        }
        try {
            const outBytes = await processVideo(ffmpeg, videoBytes, duration);
            if (outBytes) {
                reply({ type: 'vc_sandbox_result', id, bytes: outBytes }, [outBytes]);
            }
            else {
                reply({ type: 'vc_sandbox_result', id, bytes: null });
            }
        }
        catch (e) {
            console.error('[VaultSandbox] processVideo failed:', e);
            reply({ type: 'vc_sandbox_result', id, error: e?.message ?? String(e) });
        }
    }
});
async function processVideo(fm, videoBytes, duration) {
    const ts = Date.now();
    const inputName = `input_${ts}.mp4`;
    const outputName = `preview_${ts}.webm`;
    try {
        await fm.writeFile(inputName, new Uint8Array(videoBytes));
        const baseEncodingArgs = [
            '-an',
            '-c:v', 'libvpx',
            '-crf', '40',
            '-b:v', '0',
            '-cpu-used', '5',
            '-deadline', 'realtime',
            '-threads', '4',
        ];
        if (duration <= 20) {
            await fm.exec([
                '-i', inputName,
                '-t', '20',
                '-vf', 'scale=426:240',
                ...baseEncodingArgs,
                outputName,
            ]);
        }
        else {
            const segmentDuration = 2;
            const numSegments = 10;
            const interval = (duration - 20) / (numSegments - 1);
            const inputArgs = [];
            const filterParts = [];
            for (let i = 0; i < numSegments; i++) {
                const startTimestamp = (i * interval).toFixed(2);
                inputArgs.push('-ss', startTimestamp, '-t', segmentDuration.toString(), '-i', inputName);
                filterParts.push(`[${i}:v]scale=426:240,setpts=PTS-STARTPTS[v${i}]; `);
            }
            for (let i = 0; i < numSegments; i++)
                filterParts.push(`[v${i}]`);
            filterParts.push(`concat=n=${numSegments}:v=1:a=0[outv]`);
            await fm.exec([
                ...inputArgs,
                '-filter_complex', filterParts.join(''),
                '-map', '[outv]',
                ...baseEncodingArgs,
                outputName,
            ]);
        }
        const data = await fm.readFile(outputName);
        const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
        // Return a copy of the underlying buffer so transfer ownership works correctly.
        return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
    }
    finally {
        try {
            await fm.deleteFile(inputName);
        }
        catch { /* ignore */ }
        try {
            await fm.deleteFile(outputName);
        }
        catch { /* ignore */ }
    }
}
