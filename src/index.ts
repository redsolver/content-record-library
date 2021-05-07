import { CustomConnectorOptions, DacLibrary, MySky, SkynetClient } from "skynet-js";
import { PermCategory, Permission, PermType } from "skynet-mysky-utils";
import { PostContent, Convert, Post } from "./skystandards";

import {
  IFeedDACResponse, IFeedDAC, IIndex, IDictionary, IPage
} from "./types";

const DAC_DOMAIN = "feed-dac.hns";

export class FeedDAC extends DacLibrary implements IFeedDAC {
  public constructor() {
    super(DAC_DOMAIN);
  }

  client: SkynetClient | undefined

  async init(client: SkynetClient, customOptions: CustomConnectorOptions): Promise<void> {
    this.client = client;

    return super.init(client, customOptions);
  }

  public getPermissions(): Permission[] {
    return [
      new Permission(
        DAC_DOMAIN,
        DAC_DOMAIN,
        PermCategory.Discoverable,
        PermType.Read
      ),
      new Permission(
        DAC_DOMAIN,
        DAC_DOMAIN,
        PermCategory.Discoverable,
        PermType.Write
      ),
    ];
  }

  public async loadPost(
    ref: string,
  ): Promise<Post | null> {
    if (typeof this.client === "undefined") {
      throw Error('FeedDAC: SkynetClient not initialized')
    }
    if (ref.startsWith('sky://')) {
      ref = 'https://' + ref.substring(6);
    } else {
      throw Error('FeedDAC: Unsupported protocol')
    }
    const url = new URL(ref);

    let userId = url.hostname;

    if (userId.startsWith('ed25519-')) {
      userId = userId.substring(8);
    } else if (userId.length == 64) {
    } else {
      throw Error('FeedDAC: Unsupported userId format')
    }

    const res = await this.client.file.getJSON(userId, url.pathname.substring(1));

    if (res.data == null) {
      return null;
    }

    let index: number = + url.hash.substring(1);

    return (res.data.items as Post[])[index]
  }


  public async* loadPostsForUser(
    userId: string,
  ): AsyncGenerator<Post[]> {
    const minItemsPerPage = 8;

    if (userId.startsWith('ed25519-')) {
      userId = userId.substring(8);
    } else if (userId.length == 64) {
    } else {
      throw Error('FeedDAC: Unsupported userId format')
    }

    let skappsIndex = await this.downloadFile<IDictionary>(userId, `${DAC_DOMAIN}/skapps.json`);
    if (!skappsIndex) {
      yield [];
      return;
    }
    let skappsIndexList = Object.keys(skappsIndex)

    if (skappsIndexList.length == 0) {
      yield [];
      return;
    }

    let skapps: string[] = []

    let buffer: Post[] = []

    let skappPostBuffer: Post[] = []

    const skappTimestampLimit = new Map<string, number>();
    const skappCurrentPage = new Map<string, number>();
    const limitBeforePageEnd = new Map<string, number>();

    for (const skapp of skappsIndexList) {
      let index = await this.downloadFile<IIndex>(userId, `${DAC_DOMAIN}/${skapp}/posts/index.json`);
      if (!index) {
        /*    const index = skapps.indexOf(skapp, 0);
           if (index > -1) {
             skapps.splice(index, 1);
           } */
      } else {
        skappTimestampLimit.set(skapp, index.latestItemTimestamp ?? 0);
        skappCurrentPage.set(skapp, index.currPageNumber);
        skapps.push(skapp)
      }
    }


    const onlyOneSkapp = skapps.length == 1;

    let nextSkapp: string | null;
    let ignoreSkapp: string | null;
    let currentLimit: number | null;
    nextSkapp = null;
    ignoreSkapp = null;
    currentLimit = null;

    // Select priority skapp

    function getLatestSkapp(limitMap: Map<string, number>,
      exclude: string | null): [string, number] {
      let maxLimit = 0;
      let maxSkapp: string = "";
      for (const skapp of limitMap.keys()) {
        if (skapp === exclude) continue;

        const limit = limitMap.get(skapp) ?? 0;

        if (limit > maxLimit) {
          maxLimit = limit;
          maxSkapp = skapp;
        }
      }
      return [maxSkapp, maxLimit];
    }

    while (true) {

      if (skappTimestampLimit.size == 0) {
        break;
      }
      let currentSkapp: string;
      if (onlyOneSkapp) {
        currentSkapp = skapps[0];
      } else if (nextSkapp == null) {
        const highestLimit =
          getLatestSkapp(skappTimestampLimit, ignoreSkapp);

        currentSkapp = highestLimit[0];

        //print('highestLimit $highestLimit');
      } else {
        currentSkapp = nextSkapp;
      }

      const secondHighestLimit =
        getLatestSkapp(skappTimestampLimit, currentSkapp);

      //print('secondHighestLimit $secondHighestLimit');

      const localLimitBeforePageEnd = limitBeforePageEnd.get(currentSkapp);

      if (localLimitBeforePageEnd == null ||
        currentLimit == null ||
        currentLimit <= localLimitBeforePageEnd) {
        if ((skappCurrentPage.get(currentSkapp) ?? - 1) < 0) {
        } else {
          /* console.log(
            `[http] load page ${currentSkapp}.${skappCurrentPage.get(currentSkapp)}`); */

          let page = await this.downloadFile<IPage>(userId, `${DAC_DOMAIN}/${currentSkapp}/posts/page_${skappCurrentPage.get(currentSkapp)}.json`);

          skappCurrentPage.set(currentSkapp, (skappCurrentPage.get(currentSkapp) ?? 0) - 1)

          if (page == null) {
            continue;
          }

          limitBeforePageEnd.set(currentSkapp, page.items[0].ts ?? 0); // TODO Sort


          skappPostBuffer.push(...page.items);

        }
      }
      function compare(a: Post, b: Post) {
        if (a.ts < b.ts) {
          return 1;
        }
        if (a.ts > b.ts) {
          return -1;
        }
        return 0;
      }

      skappPostBuffer.sort(compare);

      ignoreSkapp = null;
      nextSkapp = null;

      while (skappPostBuffer.length != 0) {
        const post = skappPostBuffer[0];

        skappTimestampLimit.set(currentSkapp, post.ts);
        currentLimit = post.ts;

        if (post.ts < secondHighestLimit[1]) {
          nextSkapp = secondHighestLimit[0];
          ignoreSkapp = currentSkapp;
          break;
        }

        buffer.push(post);

        skappPostBuffer = skappPostBuffer.slice(1)
      }

      if (buffer.length >= minItemsPerPage) {
        yield buffer;

        buffer = [];
      }

      if (skappPostBuffer.length == 0) {
        skappTimestampLimit.set(currentSkapp, (skappTimestampLimit.get(currentSkapp) ?? 0) - 1)

        if ((skappCurrentPage.get(currentSkapp) ?? -1) < 0) {
          skappCurrentPage.delete(currentSkapp);
          skappTimestampLimit.delete(currentSkapp);
        }
      }
    }
    yield buffer;
    console.log('Reached end of all posts.');
  }



  // downloadFile merely wraps getJSON but is typed in a way that avoids
  // repeating the awkward "as unknown as T" everywhere
  private async downloadFile<T>(userId: string, path: string): Promise<T | null> {

    if (typeof this.client === "undefined") {
      throw Error('FeedDAC: SkynetClient not initialized')
    }

    console.log("downloading file at path", path);
    const { data } = await this.client.file.getJSON(userId, path);
    if (!data) {
      console.log("no data found at path", path);
      return null;
    }
    console.log("data found at path", path, data);
    return (data as unknown) as T;
  }

  public async createPost(
    content: PostContent | string,
    mentions: string[] = [],
  ): Promise<IFeedDACResponse> {
    if (!this.connector) {
      throw new Error("Connector not initialized");
    }

    if (typeof content === 'string') {
      content = Convert.toPostContent(content);
    }

    return await this.connector.connection
      .remoteHandle()
      .call("createPost", content, mentions);
  }

  public async createComment(
    content: PostContent | string,
    commentTo: string,
    parent: Post | string,
    mentions: string[] = []
  ): Promise<IFeedDACResponse> {
    if (!this.connector) {
      throw new Error("Connector not initialized");
    }

    if (typeof content === 'string') {
      content = Convert.toPostContent(content);
    }

    if (typeof parent === 'string') {
      parent = Convert.toPost(parent);
    }

    return await this.connector.connection
      .remoteHandle()
      .call("createComment", content,
        commentTo,
        parent,
        mentions);
  }

  public async createRepost(
    repostOf: string,
    parent: Post | string,
    mentions: string[] = [],
  ): Promise<IFeedDACResponse> {
    if (!this.connector) {
      throw new Error("Connector not initialized");
    }
    if (typeof parent === 'string') {
      parent = Convert.toPost(parent);
    }

    return await this.connector.connection
      .remoteHandle()
      .call("createRepost", repostOf, parent, mentions);
  }
}
