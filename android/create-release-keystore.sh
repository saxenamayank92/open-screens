#!/usr/bin/env bash
# Generates an official release keystore for Google Play publishing
set -e

KEYSTORE_PATH="${1:-$HOME/openscreens.keystore}"
ALIAS="screens"

echo "Generating release keystore at: $KEYSTORE_PATH"
keytool -genkey -v -keystore "$KEYSTORE_PATH" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=OpenScreens, OU=Displays, O=OpenScreens, L=Toronto, ST=Ontario, C=CA"

echo ""
echo "Keystore generated successfully at: $KEYSTORE_PATH"
echo "To build a signed release bundle (.aab) for Google Play:"
echo "export SCREENS_KEYSTORE=\"$KEYSTORE_PATH\""
echo "export SCREENS_STORE_PASSWORD=\"<your-password>\""
echo "export SCREENS_KEY_ALIAS=\"$ALIAS\""
echo "export SCREENS_KEY_PASSWORD=\"<your-password>\""
echo "./gradlew bundleProductionRelease"
