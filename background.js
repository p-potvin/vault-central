// Listen for the keyboard shortcut
browser.commands.onCommand.addListener(async (command) => {
  if (command === "capture-video") {
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      
      // Ask the content script for the data under the mouse
      const data = await browser.tabs.sendMessage(tab.id, { action: "get_video_data" });

      if (data && data.url) {
        
        // If content.js couldn't get a thumbnail, fallback to captureVisibleTab
        if (!data.thumbnail || data.thumbnail === "") {
            try {
                data.thumbnail = await browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
            } catch(e) {
                console.error("Screenshot capture failed:", e);
            }
        }

        // If we don't have a raw video source (maybe we hovered a link/thumbnail), let's try to extract it from the actual linked page HTML
        if (!data.rawVideoSrc && data.url) {
            try {
                const res = await fetch(data.url);
                const html = await res.text();
                
                // Matches <source src="..."> or <video src="...">, prioritizing standard video formats 
                // but also allowing general tags if we can't find explicitly marked ones.
                const sourceMatch = html.match(/<source[^>]+src=["']([^"']+)["'][^>]*type=["']video\//i)
                                  || html.match(/<source[^>]+type=["']video\/[^>]+src=["']([^"']+)["']/i)
                                  || html.match(/<video[^>]+src=["']([^"']+)["']/i)
                                  || html.match(/property="og:video[:url]*"\s+content=["']([^"']+)["']/i)
                                  || html.match(/content=["']([^"']+)["']\s+property="og:video[:url]*"/i)
                                  || html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|webm|ogg)[^"']*)["']/i)
                                  || html.match(/(?:(?:content|video(?:Url)?|src|file)["']?\s*[:=]\s*["'])([^"']+\.(?:mp4|webm|m3u8|ogg)[^"']*)/i)
                                  || html.match(/(https?:\/\/[a-zA-Z0-9.\-_~:#?\[\]@!$&'()*+,;=]+(?:mp4|webm|m3u8|ogg)[a-zA-Z0-9.\-_~:#?\[\]@!$&'()*+,;=]*)/i);

                if (sourceMatch && sourceMatch[1]) {
                    let extractedUrl = sourceMatch[1];
                    // Handle relative URLs perfectly using the URL constructor
                    try {
                        extractedUrl = new URL(extractedUrl, data.url).href;
                    } catch (e) {
                        console.error("Failed to parse relative URL:", e);
                    }
                    data.rawVideoSrc = extractedUrl;
                    data.type = "video"; // upgrade the type since we found a video                } else {
                    // Fallback to active page rendering: Simulate click & wait for DOM mutations
                    console.log("Regex failed, falling back to hidden tab extraction...");
                    try {
                        // Creating pinned:true makes it physically small/hide the title, making it less intrusive
                        const scraperTab = await browser.tabs.create({ url: data.url, active: false, pinned: true });
                        
                        const extractedFromTab = await new Promise((resolve) => {
                            let isResolved = false;
                            
                            const cleanup = (res) => {
                                if (isResolved) return;
                                isResolved = true;
                                try { browser.tabs.remove(scraperTab.id); } catch(e){}
                                resolve(res);
                            };
                            
                            // Hard system timeout: 8 seconds
                            setTimeout(() => cleanup(null), 8000);
                            
                            const listener = async (tabId, info) => {
                                if (tabId === scraperTab.id && info.status === 'complete') {
                                    browser.tabs.onUpdated.removeListener(listener);
                                    
                                    try {
                                        const scripting = typeof browser !== 'undefined' && browser.scripting ? browser.scripting : chrome.scripting;
                                        const results = await scripting.executeScript({
                                            target: { tabId: scraperTab.id, allFrames: true },
                                            func: () => {
                                                return new Promise((res) => {
                                                    const getV = () => {
                                                        const v = document.querySelector('video');
                                                        if (v && v.src && !v.src.startsWith('blob:')) return v.src;
                                                        const s = document.querySelector('video source');
                                                        if (s && s.src && !s.src.startsWith('blob:')) return s.src;
                                                        return null;
                                                    };
                                                    
                                                    let existing = getV();
                                                    if (existing) return res(existing);

                                                    const observer = new MutationObserver(() => {
                                                        let src = getV();
                                                        if (src) {
                                                            observer.disconnect();
                                                            res(src);
                                                        }
                                                    });
                                                    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true });

                                                    // Simulate interactions to trigger video load
                                                    setTimeout(() => {
                                                        try {
                                                            const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
                                                            if (el) el.click();
                                                        } catch(e) {}
                                                        
                                                        document.querySelectorAll('[class*="play" i], [id*="play" i], [aria-label*="play" i], .player').forEach(b => {
                                                            try { b.click(); } catch(e){}
                                                        });
                                                    }, 500);

                                                    // Give up after 4s
                                                    setTimeout(() => {
                                                        observer.disconnect();
                                                        res(getV());
                                                    }, 4000);
                                                });
                                            }
                                        });

                                        if (results && results.length > 0) {
                                            const successResult = results.find(r => r.result);
                                            cleanup(successResult ? successResult.result : null);
                                        } else {
                                            cleanup(null);
                                        }
                                    } catch (err) {
                                        console.error("Script injection failed:", err);
                                        cleanup(null);
                                    }
                                }
                            };
                            browser.tabs.onUpdated.addListener(listener);
                        });
                        
                        if (extractedFromTab) {
                            try {
                                data.rawVideoSrc = new URL(extractedFromTab, data.url).href;
                            } catch(e) {
                                data.rawVideoSrc = extractedFromTab; // fallback if URL constructor fails
                            }
                            data.type = "video";
                        }
                    } catch (e) {
                        console.error("Tab scraper fallback failed:", e);
                    }                }
            } catch (err) {
                console.error("Failed to fetch raw HTML for video source extraction:", err);
            }
        }

        const storage = await browser.storage.local.get({ savedVideos: [] });
        const isDuplicate = storage.savedVideos.some(v => v.url === data.url);

        if (isDuplicate) {
          storage.savedVideos = storage.savedVideos.filter(v => v.url !== data.url);
          await browser.storage.local.set({ savedVideos: storage.savedVideos });
          await browser.tabs.sendMessage(tab.id, { action: "show_notification", type: "removed", message: "Removed from favorites!" });
        } else {
          storage.savedVideos.push(data);
          await browser.storage.local.set({ savedVideos: storage.savedVideos });
          await browser.tabs.sendMessage(tab.id, { action: "show_notification", type: "success", message: "Saved successfully!" });
        }
      } else {
        await browser.tabs.sendMessage(tab.id, { action: "show_notification", type: "error", message: "Could not capture link data." });
      }
    } catch (e) {
      console.error(e);
    }
  }
});

// Open the dashboard when clicking the extension icon
browser.action.onClicked.addListener(() => {
  browser.tabs.create({ url: "dashboard.html" });
});

// Handle cross-origin fetch requests from the dashboard
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetch_html") {
    fetch(request.url)
      .then(res => res.text())
      .then(html => sendResponse({ html: html }))
      .catch(err => sendResponse({ error: err.toString() }));
    return true; // Keep the message channel open for async response
  }
});

