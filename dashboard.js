async function loadVideos() {
  const data = await browser.storage.local.get({ savedVideos: [] });
  const list = document.getElementById('list');
  list.innerHTML = '';

  data.savedVideos.forEach((vid, index) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img src="${vid.thumbnail || 'https://via.placeholder.com/160x90?text=No+Thumb'}">
      <div class="title">${vid.title}</div>
      <a href="${vid.url}" target="_blank">Open Link</a>
      <button data-index="${index}">Delete</button>
    `;
    list.appendChild(card);
  });
}

document.addEventListener('click', async (e) => {
  if (e.target.tagName === 'BUTTON') {
    const index = e.target.dataset.index;
    const data = await browser.storage.local.get({ savedVideos: [] });
    data.savedVideos.splice(index, 1);
    await browser.storage.local.set({ savedVideos: data.savedVideos });
    loadVideos();
  }
});

loadVideos();