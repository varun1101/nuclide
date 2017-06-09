/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 *
 * @flow
 * @format
 */

import {Observable} from 'rxjs';
import * as Actions from './Actions';
import invariant from 'invariant';
import {getProviders} from '../providers';
import {DeviceTask} from '../DeviceTask';
import {createCache} from '../Cache';

import type {ActionsObservable} from '../../../commons-node/redux-observable';
import type {Action, Store, AppState, ProcessTask, Process} from '../types';

export function setDeviceEpic(
  actions: ActionsObservable<Action>,
  store: Store,
): Observable<Action> {
  return actions.ofType(Actions.SET_DEVICE).switchMap(action => {
    invariant(action.type === Actions.SET_DEVICE);
    const state = store.getState();
    return Observable.merge(
      getInfoTables(state).switchMap(infoTables =>
        Observable.of(Actions.setInfoTables(infoTables)),
      ),
      getProcessTasks(state).switchMap(processTasks =>
        Observable.of(Actions.setProcessTasks(processTasks)),
      ),
      getDeviceTasks(state).switchMap(deviceTasks =>
        Observable.of(Actions.setDeviceTasks(deviceTasks)),
      ),
    );
  });
}

export function setProcessesEpic(
  actions: ActionsObservable<Action>,
  store: Store,
): Observable<Action> {
  return actions.ofType(Actions.SET_PROCESSES).switchMap(action => {
    invariant(action.type === Actions.SET_PROCESSES);
    const state = store.getState();
    return getProcessTasks(state).switchMap(processTasks =>
      Observable.of(Actions.setProcessTasks(processTasks)),
    );
  });
}

function getInfoTables(
  state: AppState,
): Observable<Map<string, Map<string, string>>> {
  const device = state.device;
  if (device == null) {
    return Observable.of(new Map());
  }
  return Observable.merge(
    ...Array.from(getProviders().deviceInfo)
      .filter(provider => provider.getType() === state.deviceType)
      .map(provider => {
        return provider
          .isSupported(state.host)
          .switchMap(isSupported => {
            if (!isSupported) {
              return Observable.empty();
            }
            return provider.fetch(state.host, device.name).map(list => ({
              title: provider.getTitle(),
              list,
              priority: provider.getPriority === undefined
                ? -1
                : provider.getPriority(),
            }));
          })
          .catch(() => Observable.empty());
      }),
  )
    .toArray()
    .map(infoTables =>
      infoTables
        .sort((a, b) => b.priority - a.priority)
        .map(table => [table.title, table.list]),
    )
    .map(infoTables => new Map(infoTables));
}

function getProcessTasks(state: AppState): Observable<ProcessTask[]> {
  const device = state.device;
  if (device == null) {
    return Observable.of([]);
  }
  return Observable.merge(
    ...Array.from(getProviders().processTask)
      .filter(provider => provider.getType() === state.deviceType)
      .map(provider => {
        return provider
          .getSupportedPIDs(state.host, device.name, state.processes)
          .map(supportedSet => {
            return {
              type: provider.getTaskType(),
              run: (proc: Process) =>
                provider.run(state.host, device.name, proc),
              isSupported: (proc: Process) => supportedSet.has(proc.pid),
              name: provider.getName(),
            };
          });
      }),
  ).toArray();
}

// The actual device tasks are cached so that if a task is running when the store switches back and
// forth from the device associated with that task, the same running task is used
const deviceTaskCache = createCache();
function getDeviceTasks(state: AppState): Observable<DeviceTask[]> {
  const device = state.device;
  if (device == null) {
    return Observable.of([]);
  }
  return Observable.merge(
    ...Array.from(getProviders().deviceTask)
      .filter(provider => provider.getType() === state.deviceType)
      .map(provider => {
        return provider
          .isSupported(state.host)
          .switchMap(isSupported => {
            if (!isSupported) {
              return Observable.empty();
            }
            return Observable.of(
              deviceTaskCache.getOrCreate(
                `${state.host}-${device.name}-${provider.getName()}`,
                () =>
                  new DeviceTask(
                    () => provider.getTask(state.host, device.name),
                    provider.getName(),
                  ),
              ),
            );
          })
          .catch(() => Observable.empty());
      }),
  )
    .toArray()
    .map(actions =>
      actions.sort((a, b) => a.getName().localeCompare(b.getName())),
    );
}
