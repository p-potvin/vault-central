// Listen for the keyboard shortcut
browser.commands.onCommand.addListener(async (command) => {
  if (command === "capture-video") {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    
    // Ask the content script for the data under the mouse
    const data = await browser.tabs.sendMessage(tab.id, { action: "get_video_data" });

    if (data) {
      const storage = await browser.storage.local.get({ savedVideos: [] });
      storage.savedVideos.push(data);
      await browser.storage.local.set({ savedVideos: storage.savedVideos });
      console.log("Video saved!");
    }
  }
});

// Open the dashboard when clicking the extension icon
browser.action.onClicked.addListener(() => {
  browser.tabs.create({ url: "dashboard.html" });
});