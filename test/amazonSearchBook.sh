# Test the amazonSearchBook Firebase function using the Firebase Functions emulator

amazonSearchBookUrl="http://127.0.0.1:5001/a-thousand-worlds/us-central1/amazonSearchBook"

firebase emulators:start --only functions &
SERVER_PID=$!
trap 'kill $SERVER_PID' EXIT
for i in {1..5}; do
  echo "Ping $amazonSearchBookUrl..."

  if curl -sf "$amazonSearchBookUrl" > /dev/null; then
    eacho "Firebase Functions emulator is running."

    result=$(curl -sf "$amazonSearchBookUrl?keyword=catia%20chien%20fireworks");
    if [[ $result == *"Fireworks-Matthew-Burgess"* ]]; then
      exit 0
    else
      echo "Unexpected response: $result" >&2
      exit 1
    fi
  fi
  sleep 5
done
echo "Server failed to respond" >&2
exit 1
