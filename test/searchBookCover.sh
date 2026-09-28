# Test the searchBookCover Firebase function using the Firebase Functions emulator

searchBookCoverUrl="http://127.0.0.1:5001/a-thousand-worlds/us-central1/searchBookCover"

firebase emulators:start --only functions &
SERVER_PID=$!
trap 'kill $SERVER_PID' EXIT
for i in {1..5}; do
  echo "Ping $searchBookCoverUrl..."

  if curl -sf "$searchBookCoverUrl" > /dev/null; then
    echo "Firebase Functions emulator is running."

    result=$(curl -sf "$searchBookCoverUrl?title=Fireworks&author=Catia%20Chien");
    if [[ $result == *"thumbnail"* ]]; then
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
