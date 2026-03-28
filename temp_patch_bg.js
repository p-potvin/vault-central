const fs = require('fs');

const path = 'background/scripts/background.ts';
let content = fs.readFileSync(path, 'utf8');

const targetStr =               // 2. DOM Extraction via Script Injection
              const tabUpdateListener = (tabId: number, info: browser.Tabs.OnUpdatedChangeInfoType) => {
                  if (tabId === scraperTabId && info.status === 'complete') {
                      browser.tabs.onUpdated.removeListener(tabUpdateListener);
                      injectScript();
                  }
              };
              browser.tabs.onUpdated.addListener(tabUpdateListener);

              const injectScript = async () => {;

const newStr =               let isCheckingCaptcha = false;
              let captchaBypassEngaged = false;

              const handleCaptchaDetected = () => {
                  if (isResolved || scraperWindowId === undefined || captchaBypassEngaged) return;
                  captchaBypassEngaged = true;

                  // Give user 2 minutes to manual solve
                  if (globalTimeoutId) clearTimeout(globalTimeoutId);
                  globalTimeoutId = setTimeout(() => {
                      cleanup(latestM3u8 ? { src: latestM3u8, metadata: defaultMetadata } : null, "Manual Captcha bypass timeout reached");
                  }, 120000);

                  // Pop the window up
                  browser.windows.update(scraperWindowId, { state: "normal", focused: true }).catch(() => {});
                  
                  // Reset injection flag so when it finally passes, it re-injects
                  injectionStarted = false;
              };

              // 2. DOM Extraction via Script Injection
              const tabUpdateListener = async (tabId: number, info: browser.Tabs.OnUpdatedChangeInfoType, tab: browser.Tabs.Tab) => {
                  if (tabId === scraperTabId) {
                      
                      // Fast title check
                      if (tab.title && (tab.title.includes("Just a moment") || tab.title.toLowerCase().includes("attention required"))) {
                          handleCaptchaDetected();
                      }

                      if (info.status === 'complete') {
                          if (isCheckingCaptcha) return;
                          isCheckingCaptcha = true;

                          try {
                              const captchaRes = await browser.scripting.executeScript({
                                  target: { tabId },
                                  func: () => document.title.includes("Just a moment") || !!document.querySelector('.cf-turnstile, #challenge-stage, #cf-please-wait')
                              });
                              if (captchaRes && captchaRes[0]?.result) {
                                  isCheckingCaptcha = false;
                                  handleCaptchaDetected();
                                  return; // wait for next navigation (user solving captcha)
                              }
                          } catch (e) {}

                          isCheckingCaptcha = false;
                          browser.tabs.onUpdated.removeListener(tabUpdateListener);
                          injectScript();
                      }
                  }
              };
              browser.tabs.onUpdated.addListener(tabUpdateListener);

              const injectScript = async () => {;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, newStr);
    fs.writeFileSync(path, content, 'utf8');
    console.log("Success");
} else {
    console.error("Target string not found in background.ts. Let's dump exact contents:");
    console.log(content.indexOf('// 2. DOM Extraction via Script Injection'));
}
