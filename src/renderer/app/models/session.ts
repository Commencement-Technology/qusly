import { Client } from 'qusly-core';

import { ISite } from '~/interfaces';
import store from '../store';
import { Tree } from './tree';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

let id = 0;

export class Session {
  public id = id++;

  public client = new Client();

  public tree = new Tree(this);

  public status: ConnectionStatus = 'disconnected';

  public startPath: string;

  constructor(public site: ISite) { }

  public async connect() {
    if (this.status === 'disconnected') {
      this.status = 'connecting';

      await this.client.connect(this.site);
      const path = await this.client.pwd();

      this.startPath = path;
      this.status = 'connected';
      this.tree.fetch(this.tree.items[0]);
    }
  }

  public async close() {
    store.sessions.list = store.sessions.list.filter(r => r !== this);
    await this.client.disconnect();
  }
}