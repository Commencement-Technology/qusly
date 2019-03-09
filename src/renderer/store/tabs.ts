import * as React from 'react';
import { observable } from 'mobx';
import { TweenLite } from 'gsap';
import { ipcRenderer } from 'electron';

import { Tab } from '@renderer/models';

import {
  TAB_ANIMATION_DURATION,
  TABS_PADDING,
  TAB_ANIMATION_EASING,
} from '@renderer/constants';

import HorizontalScrollbar from '@renderer/components/HorizontalScrollbar';
import store from '.';

export class TabsStore {
  @observable
  public isDragging: boolean = false;

  @observable
  public scrollbarVisible: boolean = false;

  @observable
  public selectedTabId: number;

  @observable
  public hoveredTabId: number;

  @observable
  public tabs: Tab[] = [];

  @observable
  public scrollable = false;

  public lastScrollLeft: number = 0;
  public lastMouseX: number = 0;
  public mouseStartX: number = 0;
  public tabStartX: number = 0;

  public scrollbarRef = React.createRef<HorizontalScrollbar>();
  public containerRef = React.createRef<HTMLDivElement>();

  public indicatorRef = React.createRef<HTMLDivElement>();

  private rearrangeTabsTimer = {
    canReset: false,
    time: 0,
    interval: null as any,
  };

  constructor() {
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('resize', this.onResize);

    this.rearrangeTabsTimer.interval = setInterval(() => {
      // Set widths and positions for tabs 3 seconds after a tab was closed
      if (
        this.rearrangeTabsTimer.canReset &&
        this.rearrangeTabsTimer.time === 3
      ) {
        this.updateTabsBounds(true);
        this.rearrangeTabsTimer.canReset = false;
      }
      this.rearrangeTabsTimer.time++;
    }, 1000);

    ipcRenderer.on('add-tab', (e: any, options: any) => {
      const tab = this.tabs.find(x => x.id === options.id);

      if (tab) {
        tab.isClosing = false;
        store.tabsStore.updateTabsBounds(true);
        clearTimeout(tab.removeTimeout);

        if (options.active) {
          tab.select();
        }
      } else {
        this.addTab(options.id, options.title);
      }
    });

    ipcRenderer.on('remove-tab', (e: any, id: number) => {
      const tab = this.getTabById(id);
      if (tab) {
        tab.close();
      }
    });

    ipcRenderer.on('update-tab-title', (e: any, data: any) => {
      const tab = this.getTabById(data.id);
      if (tab) {
        tab.title = data.title;
      }
    });

    ipcRenderer.on('select-tab', (e: any, id: number) => {
      const tab = this.getTabById(id);
      if (tab) {
        tab.select();
      }
    });
  }

  public resetRearrangeTabsTimer() {
    this.rearrangeTabsTimer.time = 0;
    this.rearrangeTabsTimer.canReset = true;
  }

  public onResize = (e: Event) => {
    if (e.isTrusted) {
      store.tabsStore.updateTabsBounds(false);
    }
  };

  public get containerWidth() {
    if (this.containerRef.current) {
      return this.containerRef.current.offsetWidth;
    }
    return 0;
  }

  public get selectedTab() {
    return this.getTabById(this.selectedTabId);
  }

  public get hoveredTab() {
    return this.getTabById(this.hoveredTabId);
  }

  public getTabById(id: number) {
    return this.tabs.find(x => x.id === id && !x.isClosing);
  }

  public addTab(id: number, title: string, select = true) {
    const tab = new Tab(id, title);
    this.tabs.push(tab);

    requestAnimationFrame(() => {
      tab.setLeft(tab.getLeft(), false);
      this.updateTabsBounds(true);

      this.scrollbarRef.current.scrollToEnd(TAB_ANIMATION_DURATION * 1000);

      if (select) {
        tab.select();
      }
    });

    return tab;
  }

  public removeTab(tab: Tab) {
    (this.tabs as any).remove(tab);
  }

  public updateTabsBounds(animation: boolean) {
    this.setTabsWidths(animation);
    this.setTabsLefts(animation);
  }

  public setTabsWidths(animation: boolean) {
    const tabs = this.tabs.filter(x => !x.isClosing);

    const containerWidth = this.containerWidth;

    for (const tab of tabs) {
      const width = tab.getWidth(containerWidth, tabs);
      tab.setWidth(width, animation);

      this.scrollable = width === 72;
    }
  }

  public setTabsLefts(animation: boolean) {
    const tabs = this.tabs
      .filter(x => !x.isClosing)
      .slice()
      .sort((a, b) => a.position - b.position);

    let left = 0;

    for (const tab of tabs) {
      tab.setLeft(left, animation);

      left += tab.width + TABS_PADDING;
    }
  }

  public replaceTab(firstTab: Tab, secondTab: Tab) {
    const position1 = firstTab.tempPosition;

    secondTab.setLeft(firstTab.getLeft(true), true);

    firstTab.tempPosition = secondTab.tempPosition;
    secondTab.tempPosition = position1;
  }

  public getTabsToReplace(callingTab: Tab, direction: string) {
    let tabs = this.tabs
      .slice()
      .sort((a, b) => a.tempPosition - b.tempPosition);

    const index = tabs.indexOf(callingTab);

    if (direction === 'left') {
      for (let i = index - 1; i >= 0; i--) {
        const tab = tabs[i];
        if (callingTab.left <= tab.width / 2 + tab.left) {
          this.replaceTab(tabs[i + 1], tab);
          tabs = tabs.sort((a, b) => a.tempPosition - b.tempPosition);
        } else {
          break;
        }
      }
    } else if (direction === 'right') {
      for (let i = index + 1; i < tabs.length; i++) {
        const tab = tabs[i];
        if (callingTab.left + callingTab.width >= tab.width / 2 + tab.left) {
          this.replaceTab(tabs[i - 1], tab);
          tabs = tabs.sort((a, b) => a.tempPosition - b.tempPosition);
        } else {
          break;
        }
      }
    }
  }

  public onMouseUp = () => {
    const selectedTab = this.selectedTab;

    this.isDragging = false;

    for (const tab of this.tabs) {
      tab.position = tab.tempPosition;
    }

    this.setTabsLefts(true);

    if (selectedTab) {
      selectedTab.isDragging = false;

      this.moveIndicator(selectedTab);
    }
  };

  public onMouseMove = (e: any) => {
    const { selectedTab } = store.tabsStore;

    if (this.isDragging) {
      const container = this.containerRef;
      const {
        tabStartX,
        mouseStartX,
        lastMouseX,
        lastScrollLeft,
      } = store.tabsStore;

      const boundingRect = container.current.getBoundingClientRect();

      if (Math.abs(e.pageX - mouseStartX) < 5) {
        return;
      }

      selectedTab.isDragging = true;

      const newLeft =
        tabStartX +
        e.pageX -
        mouseStartX -
        (lastScrollLeft - container.current.scrollLeft);

      let left = Math.max(0, newLeft);

      if (
        newLeft + selectedTab.width >
        boundingRect.width +
          boundingRect.left +
          container.current.scrollLeft -
          2 * TABS_PADDING
      ) {
        left =
          boundingRect.width +
          boundingRect.left +
          container.current.scrollLeft -
          selectedTab.width -
          2 * TABS_PADDING;
      }

      selectedTab.setLeft(left, false);

      this.getTabsToReplace(
        selectedTab,
        lastMouseX - e.pageX >= 1 ? 'left' : 'right',
      );

      this.lastMouseX = e.pageX;

      this.moveIndicator(selectedTab, false);
    }
  };

  public animateProperty(
    property: string,
    obj: any,
    value: number,
    animation: boolean,
  ) {
    if (obj) {
      const props: any = {
        ease: animation ? TAB_ANIMATION_EASING : null,
      };
      props[property] = value;
      TweenLite.to(obj, animation ? TAB_ANIMATION_DURATION : 0, props);
    }
  }

  public moveIndicator(tab: Tab, animation = true) {
    TweenLite.to(
      this.indicatorRef.current,
      animation ? TAB_ANIMATION_DURATION : 0,
      {
        width: tab.width,
        left: tab.left,
        ease: animation ? TAB_ANIMATION_EASING : 'unset',
      },
    );
  }
}
