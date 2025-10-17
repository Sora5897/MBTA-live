// MBTA Live App
const saveKeyButton = document.getElementById('saveKey');
const apiKeyInput = document.getElementById('apiKey');
const fetchButton = document.getElementById('fetchData');
const output = document.getElementById('output');

// Load saved key
apiKeyInput.value = localStorage.getItem('mbta_api_key') || '';

saveKeyButton.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  localStorage.setItem('mbta_api_key', key);
  alert('API key saved locally!');
});

fetchButton.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const headers = apiKey ? { 'x-api-key': apiKey } : {};
  output.textContent = 'Loading...';
  try {
    const res = await fetch('https://api-v3.mbta.com/vehicles?filter[route]=1', { headers });
    const data = await res.json();
    output.textContent = JSON.stringify(data.data.slice(0, 5), null, 2);
  } catch (err) {
    output.textContent = 'Error fetching data: ' + err;
  }
});
