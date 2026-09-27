#!/usr/bin/env bash
# Build ZenPen.apk without Gradle:
# aapt2 (resources) -> javac -> d8 (dex) -> zip -> zipalign -> apksigner
#
# Signing is configurable via environment variables (used by CI):
#   KEYSTORE      path to the keystore (default: ./zenpen.keystore,
#                 generated on first build with the default passwords)
#   KS_PASS       keystore password (default: zenpen)
#   KEY_PASS      key password (default: $KS_PASS)
set -euo pipefail

SDK="${SDK:-$PWD/sdk}"
BT="$SDK/build-tools/37.0.0"
PLATFORM="$SDK/platforms/android-34/android.jar"
KEYSTORE="${KEYSTORE:-zenpen.keystore}"
KS_PASS="${KS_PASS:-zenpen}"
KEY_PASS="${KEY_PASS:-$KS_PASS}"
OUT="Kanso.apk"

rm -rf build
mkdir -p build/gen build/classes build/dex

echo "[1/6] Compiling resources..."
"$BT/aapt2" compile --dir app/res -o build/res.zip

echo "[2/6] Linking resources + manifest..."
"$BT/aapt2" link \
	-o build/zenpen-base.apk \
	-I "$PLATFORM" \
	--manifest app/AndroidManifest.xml \
	--java build/gen \
	--auto-add-overlay \
	build/res.zip

echo "[3/6] Compiling Java..."
javac \
	--release 8 \
	-classpath "build/gen:$PLATFORM" \
	-d build/classes \
	$(find app/src -name "*.java") \
	build/gen/io/kanso/app/R.java

echo "[4/6] Dexing..."
"$BT/d8" \
	--release \
	--lib "$PLATFORM" \
	--min-api 24 \
	--output build/dex \
	$(find build/classes -name "*.class")

echo "[5/6] Packaging..."
cp build/zenpen-base.apk build/zenpen-unsigned.apk
# Web files must live under assets/ in the APK - that is where Android's
# file:///android_asset/ URL scheme reads from. Stage them so the archive
# contains assets/www/... (zip stores the paths as given).
mkdir -p build/staging/assets
cp -r app/assets/www build/staging/assets/www
cd build/staging && zip -q -r ../zenpen-unsigned.apk assets && cd ../..
cd build && zip -q -j zenpen-unsigned.apk dex/classes.dex && cd ..
"$BT/zipalign" -f 4 build/zenpen-unsigned.apk build/zenpen-aligned.apk

if [ ! -f "$KEYSTORE" ]; then
	echo "[6/6] Generating signing key..."
	keytool -genkeypair \
		-keystore "$KEYSTORE" \
		-alias zenpen \
		-keyalg RSA -keysize 2048 -validity 10000 \
		-storepass "$KS_PASS" -keypass "$KEY_PASS" \
		-dname "CN=ZenPen, OU=Apps, O=ZenPen, L=Internet, C=XX"
fi

echo "[6/6] Signing..."
"$BT/apksigner" sign \
	--ks "$KEYSTORE" \
	--ks-key-alias zenpen \
	--ks-pass pass:"$KS_PASS" \
	--key-pass pass:"$KEY_PASS" \
	--out "$OUT" \
	build/zenpen-aligned.apk

"$BT/apksigner" verify --verbose "$OUT" | head -5
echo
echo "Done: $OUT ($(du -h "$OUT" | cut -f1))"
