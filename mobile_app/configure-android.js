import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestPath = path.join(__dirname, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

if (!fs.existsSync(manifestPath)) {
  console.error(`Error: AndroidManifest.xml not found at ${manifestPath}. Make sure you have run 'npx cap add android' first.`);
  process.exit(1);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');

// 1. Add camera permission if not present
const cameraPermission = '<uses-permission android:name="android.permission.CAMERA" />';
if (!manifest.includes('android.permission.CAMERA')) {
  // Find the position before <application
  const appTagIndex = manifest.indexOf('<application');
  if (appTagIndex !== -1) {
    manifest = manifest.slice(0, appTagIndex) + '    ' + cameraPermission + '\n' + manifest.slice(appTagIndex);
    console.log('Added CAMERA permission to AndroidManifest.xml');
  } else {
    console.error('Could not find <application tag in AndroidManifest.xml');
  }
} else {
  console.log('CAMERA permission already exists in AndroidManifest.xml');
}

// 2. Add usesCleartextTraffic="true" to <application if not present
if (!manifest.includes('android:usesCleartextTraffic')) {
  // Find the <application tag and insert usesCleartextTraffic
  const appTagMatch = manifest.match(/<application[^>]*>/);
  if (appTagMatch) {
    const fullTag = appTagMatch[0];
    if (!fullTag.includes('android:usesCleartextTraffic')) {
      const updatedTag = fullTag.replace('<application', '<application android:usesCleartextTraffic="true"');
      manifest = manifest.replace(fullTag, updatedTag);
      console.log('Added android:usesCleartextTraffic="true" to <application tag');
    }
  } else {
    console.error('Could not match <application> tag for cleartext traffic update');
  }
} else {
  console.log('android:usesCleartextTraffic already configured');
}

fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log('Android configuration updated successfully.');
