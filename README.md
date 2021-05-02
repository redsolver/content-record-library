# Feed DAC for MySky

Forked from `@skynethq/content-record-library`.

This DAC uses the https://github.com/SkynetHQ/skystandards data structures

## Usage

Using the library is very straightforward. In this section we'll show an example
of how a skapp could use the Feed DAC library and create a new post.

```typescript
import { SkynetClient } from "skynet-js";
import { FeedDAC } from "feed-dac-library";

(async () => {
  // create client
  const client = new SkynetClient();

  // create content record
  const feedDAC = new FeedDAC();

  // load mysky
  const mySky = await client.loadMySky("exampleskapp.hns");

  // load DACs
  await mySky.loadDacs(feedDAC);

  // check login
  const isLoggedIn = await mySky.checkLogin();
  if (!isLoggedIn) {
    // request login access
  }

  const res = await feedDAC.createPost({
    text: 'Hello, world!'
  })
  console.log(`Success: ${res.success}`);
  console.log(`Error (if unsuccessful): ${res.error}`);
  console.log(`Reference to the new post: ${res.ref}`);
})();
```
