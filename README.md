# 🛡️ Vault Central

A privacy-first browser extension that lets you quickly save your favorite videos and links. Privacy comes first (your vault stays on your device), security is a close second (to protect that privacy), and functionality is the third pillar (fast, simple, and reliable). Built with TypeScript, Zod, and Vite for cross-browser compatibility (Chrome & Firefox).

---

## 🚀 Installation & Setup

If you are not a developer, follow these simple steps to get the extension running in your browser.

### 1. Prerequisites
Before starting, ensure you have the following installed on your computer:
*   **Node.js**: [Download here](https://nodejs.org/). Choose the "LTS" (Long Term Support) version.
*   **A Browser**: Chrome, Brave, Edge, or Firefox.

### 2. Prepare the Extension
1.  **Download the Code**: Click the green **Code** button at the top of this page and select **Download ZIP**. Extract the folder to your Desktop.
2.  **Open Terminal/Command Prompt**:
    *   **Windows**: Press `Win + R`, type `powershell`, and press Enter.
    *   **Mac**: Press `Cmd + Space`, type `Terminal`, and press Enter.
3.  **Navigate to the folder**: Type `cd ` (with a space) and drag the extracted folder into the terminal window, then press Enter.
4.  **Install tools**: Run the following command:
    ```bash
    npm install
    ```
5.  **Build the Vault**: Run this command to generate the final extension files:
    ```bash
    npm run build
    ```
    *This creates a new folder called `dist` in your project directory. This is the folder you will load into your browser.*

---

## 🛠️ How to Load the Extension

### For Chrome / Edge / Brave
1.  Open your browser and type `chrome://extensions/` in the address bar.
2.  In the top right, turn **ON** the switch that says **Developer mode**.
3.  Click the **Load unpacked** button in the top left.
4.  Select the `dist` folder located inside your `vault-central` directory.
5.  **Done!** Look for the Vault icon in your extensions toolbar.

### For Firefox
1.  Open Firefox and type `about:debugging#/runtime/this-firefox` in the address bar.
2.  Click **Load Temporary Add-on...**.
3.  Navigate to your `dist` folder and select any file (e.g., `manifest.json`).
4.  **Note**: This is temporary and will stay until you restart Firefox. To publish permanently, use the [Add-on Developer Hub](https://addons.mozilla.org/en-US/developers/).

---

## ⌨️ Tactical Controls
*   **Save Item**: Hover your mouse over any video/link and press the keyboard shortcut (Default: `Alt+X` or as configured in browser settings).
*   **Open Vault**: Click the extension icon in your toolbar to view your saved favorites.

---

## 🧭 Privacy & Security Policy
This version of Vault Central follows the **VaultWares privacy-first standard** (privacy → security → functionality):
*   **Privacy First**: No external tracking. Your saved items stay in your browser’s local storage unless you choose to move them elsewhere.
*   **Security Second**: Data extracted from the web is validated with Zod schemas to reduce the risk of XSS and malformed inputs.
*   **Functionality Third**: Quick shortcuts and a simple UI so the extension is easy to use day-to-day.

---

## 👨‍💻 Developer Commands
*   `npm run build`: Compile TypeScript and bundle for production (outputs to `/dist`).
*   `npm run dev`: Start Vite in development mode for live debugging.
