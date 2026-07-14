const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const TARGET_TRIPLE = 'x86_64-unknown-linux-gnu';
const BIN_DIR = path.join(__dirname, '..', 'src-tauri', 'bin');
const FFMPEG_URL = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
const TEMP_TAR = path.join(__dirname, 'ffmpeg.tar.xz');
const TEMP_DIR = path.join(__dirname, 'ffmpeg_temp');

function log(msg) {
  console.log(`[setup-sidecars] ${msg}`);
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    log(`Downloading FFmpeg from ${url}...`);
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: Status Code ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        log('Download finished.');
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  try {
    // Ensure binary directory exists
    if (!fs.existsSync(BIN_DIR)) {
      fs.mkdirSync(BIN_DIR, { recursive: true });
      log(`Created directory: ${BIN_DIR}`);
    }

    const finalPath = path.join(BIN_DIR, `ffmpeg-${TARGET_TRIPLE}`);
    
    // Check if ffmpeg sidecar already exists
    if (fs.existsSync(finalPath)) {
      log(`FFmpeg sidecar already exists at ${finalPath}. Skipping download.`);
      return;
    }

    // Download tar.xz
    await downloadFile(FFMPEG_URL, TEMP_TAR);

    // Create temp directory for extraction
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR);
    }

    log('Extracting archive using tar...');
    execSync(`tar -xf "${TEMP_TAR}" -C "${TEMP_DIR}"`);

    log('Locating ffmpeg binary in extracted archive...');
    const files = fs.readdirSync(TEMP_DIR);
    const extractedFolder = files.find(f => f.startsWith('ffmpeg-') && fs.statSync(path.join(TEMP_DIR, f)).isDirectory());
    
    if (!extractedFolder) {
      throw new Error('Could not find ffmpeg directory inside the archive.');
    }

    const ffmpegSrc = path.join(TEMP_DIR, extractedFolder, 'ffmpeg');
    
    if (!fs.existsSync(ffmpegSrc)) {
      throw new Error(`ffmpeg binary not found at ${ffmpegSrc}`);
    }

    log(`Copying FFmpeg to sidecar target: ${finalPath}`);
    fs.copyFileSync(ffmpegSrc, finalPath);

    log('Setting executable permissions...');
    fs.chmodSync(finalPath, 0o755); // chmod +x

    log('Clean up temporary files...');
    fs.rmSync(TEMP_TAR, { force: true });
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });

    log('FFmpeg sidecar setup completed successfully!');
  } catch (err) {
    log(`Error setting up sidecars: ${err.message}`);
    if (fs.existsSync(TEMP_TAR)) fs.unlinkSync(TEMP_TAR);
    if (fs.existsSync(TEMP_DIR)) fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    process.exit(1);
  }
}

main();
