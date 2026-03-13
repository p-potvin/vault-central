let hoveredElement = null;

// Track the element currently under the mouse
document.addEventListener('mousemove', (e) => {
  hoveredElement = document.elementFromPoint(e.clientX, e.clientY);
});

// Listen for the "capture" request from the background script
browser.runtime.onMessage.addListener((request) => {
  if (request.action === "get_video_data") {
    return Promise.resolve(extractData(hoveredElement));
  }
});

function extractData(el) {
  if (!el) return null;

  // 1. Look for a <video> tag or a parent containing one
  let video = el.tagName === 'VIDEO' ? el : el.querySelector('video') || el.closest('video');
  
  // 2. Look for a link <a> that might be a video
  let link = el.closest('a');

  let sourceUrl = "";
  let thumb = "";

  if (video) {
    sourceUrl = video.currentSrc || video.src;
    // Basic thumbnail attempt: capture current frame
    thumb = captureFrame(video);
  } else if (link) {
    sourceUrl = link.href;
  }

  return {
    url: sourceUrl || window.location.href,
    title: document.title,
    thumbnail: thumb,
    timestamp: Date.now()
  };
}

function captureFrame(video) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch (e) {
    return ""; // Cross-origin videos may block this
  }
}