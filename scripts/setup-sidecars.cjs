const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const BIN_DIR = path.join(__dirname, '..', 'src-tauri', 'bin');
const RTMP_DIR = path.join(__dirname, '..', 'rtmp-engine');

const FFMPEG_URLS = {
  'x86_64-unknown-linux-gnu': 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64',
  'x86_64-pc-windows-msvc': 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-win32-x64',
  'aarch64-apple-darwin': 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-arm64',
  'x86_64-apple-darwin': 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-darwin-x64',
};

const PKG_TARGETS = {
  'x86_64-unknown-linux-gnu': 'node18-linux-x64',
  'x86_64-pc-windows-msvc': 'node18-win-x64',
  'aarch64-apple-darwin': 'node18-macos-arm64',
  'x86_64-apple-darwin': 'node18-macos-x64',
};

function log(msg) {
  console.log(`[setup-sidecars] ${msg}`);
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    log(`Downloading from ${url}...`);
    const request = (currentUrl) => {
      https.get(currentUrl, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          log(`Following redirect to ${response.headers.location}...`);
          request(response.headers.location);
          return;
        }
        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', reject);
    };
    request(url);
  });
}

async function prepareTarget(targetTriple) {
  log(`--- Setting up sidecars for target: ${targetTriple} ---`);
  
  const isWin = targetTriple.includes('windows');
  const ext = isWin ? '.exe' : '';

  const engineBinName = `nectar-cast-engine-${targetTriple}${ext}`;
  const enginePath = path.join(BIN_DIR, engineBinName);

  const ffmpegBinName = `ffmpeg-${targetTriple}${ext}`;
  const ffmpegPath = path.join(BIN_DIR, ffmpegBinName);

  // 1. Build nectar-cast-engine sidecar using pkg
  if (!fs.existsSync(enginePath)) {
    log(`Building ${engineBinName} using pkg...`);
    const pkgTarget = PKG_TARGETS[targetTriple];
    const rtmpDistIndex = path.join(RTMP_DIR, 'dist', 'index.js');
    if (!fs.existsSync(rtmpDistIndex)) {
      log('Building rtmp-engine dist/index.js first...');
      execSync('npm run build', { cwd: RTMP_DIR, stdio: 'inherit' });
    }
    const pkgCmd = `npx @yao-pkg/pkg "${rtmpDistIndex}" --target ${pkgTarget} --output "${enginePath}"`;
    execSync(pkgCmd, { cwd: RTMP_DIR, stdio: 'inherit' });
    if (!isWin) {
      fs.chmodSync(enginePath, 0o755);
    }
  } else {
    log(`Engine sidecar already exists at ${enginePath}`);
  }

  // 2. Download FFmpeg sidecar
  if (!fs.existsSync(ffmpegPath)) {
    const ffmpegUrl = FFMPEG_URLS[targetTriple];
    if (ffmpegUrl) {
      await downloadFile(ffmpegUrl, ffmpegPath);
      if (!isWin) {
        fs.chmodSync(ffmpegPath, 0o755);
      }
      log(`Downloaded FFmpeg sidecar to ${ffmpegPath}`);
    } else {
      log(`Warning: No FFmpeg download URL defined for target ${targetTriple}`);
    }
  } else {
    log(`FFmpeg sidecar already exists at ${ffmpegPath}`);
  }
}

async function main() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  let targets = [];

  const args = process.argv.slice(2);
  if (args.includes('--all')) {
    targets = Object.keys(PKG_TARGETS);
  } else if (args.includes('--target')) {
    const idx = args.indexOf('--target');
    if (args[idx + 1]) {
      targets = [args[idx + 1]];
    }
  } else {
    switch (process.platform) {
      case 'win32':
        targets = ['x86_64-pc-windows-msvc'];
        break;
      case 'darwin':
        targets = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];
        break;
      case 'linux':
      default:
        targets = ['x86_64-unknown-linux-gnu'];
        break;
    }
  }

  log(`Targets to process: ${targets.join(', ')}`);

  for (const target of targets) {
    await prepareTarget(target);
  }

  log('All sidecars setup complete!');
}

main().catch((err) => {
  console.error('[setup-sidecars] Error:', err);
  process.exit(1);
});
