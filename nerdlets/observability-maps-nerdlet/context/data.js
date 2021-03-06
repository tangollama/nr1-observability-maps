/* eslint 
no-console: 0,
no-async-promise-executor: 0,
no-func-assign: 0,
require-atomic-updates: 0,
no-unused-vars: 0
*/

import React, { Component } from 'react';
import { NerdGraphQuery } from 'nr1';
import {
  getUserCollection,
  getAccountCollection,
  entityBatchQuery,
  nerdGraphQuery,
  singleNrql,
  ApmEntityBatchQuery,
  writeUserDocument
} from '../lib/utils';
import { chunk } from '../lib/helper';
import { ToastContainer, toast } from 'react-toastify';

toast.configure();

const DataContext = React.createContext();

const collectionName = 'ObservabilityMaps';
const userConfig = 'ObservabilityUserConfig';
const iconCollection = 'ObservabilityIcons';

const defaultNodeData = {
  'Select or create a map, to get started!': {
    id: 'Select or create a map, to get started!',
    y: 30,
    x: 300,
    icon: 'arrow up'
  },
  'Tip: Right click on map nodes for more options!': {
    id: 'Tip: Right click on map nodes for more options!',
    y: 100,
    x: 350,
    icon: 'help'
  }
};

const cleanName = name => name.replace(/\+/g, ' ');

export class DataProvider extends Component {
  constructor(props) {
    super(props);

    this.state = {
      selectedMap: null,
      bucketMs: { key: 1, label: '30 sec', value: 30000 },
      selectedNode: '',
      selectedLink: '',
      mapConfig: {
        nodeData: { ...defaultNodeData },
        linkData: {}
      },
      mapData: {
        nodeData: {},
        linkData: {}
      },
      data: {
        nodes: [
          defaultNodeData['Select or create a map, to get started!'],
          defaultNodeData['Tip: Right click on map nodes for more options!']
        ],
        links: []
      },
      userIcons: [],
      storeLocation: 'user',
      accountMaps: null,
      userMaps: null,
      availableMaps: [],
      accounts: [],
      userConfig: null,
      sidebarOpen: false,
      timelineOpen: false,
      sidebarView: '',
      editNodeOpen: false,
      editLinkOpen: false,
      isRefreshing: false,
      closeCharts: false,
      showContextMenu: false
    };
  }

  async componentDidMount() {
    await this.dataFetcher([
      'userConfig',
      'userMaps',
      'accountMaps',
      'accounts',
      'userIcons'
    ]);
    this.handleDefaults();
    this.refreshData();
  }

  handleDefaults = async () => {
    if (this.state.userConfig) {
      const { availableMaps, userConfig } = this.state;
      const { defaultMap } = userConfig;
      let found = false;
      for (let z = 0; z < availableMaps.length; z++) {
        if (defaultMap === availableMaps[z].id) {
          await this.selectMap(defaultMap);
          found = true;
          break;
        }
      }
      if (!found) await this.handleMapData();
    }
  };

  updateDataContextState = (stateData, actions) => {
    return new Promise(resolve => {
      this.setState(stateData, () => {
        if (actions && actions.length > 0) {
          actions.forEach(async action => {
            switch (action) {
              case 'loadMap':
                if (stateData.selectedMap) {
                  this.toastLoad = toast(
                    `Loading Map: ${cleanName(stateData.selectedMap.value)}`,
                    {
                      containerId: 'B'
                    }
                  );
                  switch (stateData.selectedMap.type) {
                    case 'user':
                      await this.pluckMap(stateData.selectedMap.value);
                      await this.handleMapData();
                      toast.dismiss(this.toastLoad);
                      break;
                  }
                } else {
                  this.toastDeleteMap = toast(
                    `Map deleted, please select another`,
                    {
                      containerId: 'B'
                    }
                  );
                  this.setState(
                    {
                      mapConfig: {
                        nodeData: { ...defaultNodeData },
                        linkData: {}
                      }
                    },
                    async () => {
                      await this.handleMapData();
                    }
                  );
                }
                break;
              case 'saveMap':
                const { storeLocation, selectedMap } = this.state;
                this.toastSaveMap = toast(
                  `Saving Map: ${cleanName(selectedMap.value)}`,
                  {
                    containerId: 'B'
                  }
                );
                switch (storeLocation) {
                  case 'account':
                    // not implemented yet
                    // writeAccountDocument("ObservabilityMaps", mapName, payload)
                    // dataFetcher(["accountMaps"])
                    break;
                  case 'user':
                    if (stateData.mapConfig) {
                      const mapConfig = JSON.parse(
                        JSON.stringify(stateData.mapConfig)
                      );
                      console.log('savingMap', mapConfig);
                      await writeUserDocument(
                        'ObservabilityMaps',
                        selectedMap.value,
                        mapConfig
                      );
                      await this.dataFetcher(['userMaps']);
                      await this.handleMapData();
                      toast.dismiss(this.toastSaveMap);
                    }
                    break;
                  default:
                    toast.dismiss(this.toastSaveMap);
                }
                break;
            }
          });
        }
        resolve();
      });
    });
  };

  pluckMap = map => {
    return new Promise(async resolve => {
      const { userMaps } = this.state;
      let found = false;
      for (let i = 0; i < userMaps.length; i++) {
        if (userMaps[i].id === map) {
          found = true;
          const mapConfig = JSON.parse(JSON.stringify(userMaps[i].document));
          this.setState({ mapConfig }, resolve(found));
        }
      }
      if (!found) resolve(found);
    });
  };

  // fetch data as required, supply array things to fetch
  dataFetcher = async actions => {
    console.log('context dataFetcher');
    return new Promise(async resolve => {
      const dataPromises = [];
      const content = [];

      actions.forEach(action => {
        switch (action) {
          case 'userMaps':
            content.push(action);
            dataPromises.push(getUserCollection(collectionName));
            break;
          case 'userIcons':
            content.push(action);
            dataPromises.push(getUserCollection(iconCollection));
            break;
          case 'accountMaps':
            content.push(action);
            dataPromises.push(getAccountCollection(collectionName));
            break;
          case 'userConfig':
            content.push(action);
            dataPromises.push(getUserCollection(userConfig, 'v1'));
            break;
          case 'accounts':
            content.push(action);
            const accountsQuery = `{actor {accounts {name id}}}`;
            dataPromises.push(NerdGraphQuery.query({ query: accountsQuery }));
            break;
        }
      });

      await Promise.all(dataPromises).then(async values => {
        const data = {};
        data.availableMaps = [];
        values.forEach((value, i) => {
          switch (content[i]) {
            case 'userMaps':
              data[content[i]] = value;
              data.availableMaps = [...data.availableMaps, ...value];
              break;
            case 'accountMaps':
              data[content[i]] = value;
              data.availableMaps = [...data.availableMaps, ...value];
              break;
            case 'userIcons':
              data[content[i]] = value;
              break;
            case 'userConfig':
              data.userConfig = value || null;
              break;
            case 'accounts':
              data.accounts =
                (((value || {}).data || {}).actor || {}).accounts || [];
              break;
          }
        });

        this.setState(data, () => {
          resolve();
        });
      });
    });
  };

  refreshData = () => {
    let interval = this.state.bucketMs.value;
    Do = Do.bind(this);
    this.refresh = setInterval(async () => Do(), interval);

    async function Do() {
      if (interval !== this.state.bucketMs.value) {
        console.log(
          `Updating... (timer: ${interval}ms to ${this.state.bucketMs.value}ms)`
        );
        interval = this.state.bucketMs.value;
        clearInterval(this.refresh);
        this.refresh = setInterval(async () => Do(), interval);
      }
      if (!this.state.isRefreshing) {
        if (this.state.selectedMap) {
          this.toastRefresh = toast(`Refreshing...`, {
            containerId: 'C'
          });

          console.log(
            `Refreshing... (timer: ${interval}ms) ${new Date().getTime()}`
          );
          this.setState({ isRefreshing: true }, async () => {
            await this.handleMapData();
            toast.dismiss(this.toastRefresh);
            this.setState({ isRefreshing: false });
          });
        }
      } else {
        console.log(
          `Already refreshing... waiting for next cycle (timer: ${interval}ms) ${new Date().getTime()}`
        );
      }
    }
  };

  selectMap = selectedMap => {
    if (typeof selectedMap === 'string' || selectedMap instanceof String) {
      const map = this.state.availableMaps.filter(
        map => map.id === selectedMap.replace(/ /g, '+')
      );
      if (map.length === 1) {
        const selected = { value: map[0].id, label: map[0].id, type: 'user' };
        this.setState({ selectedMap: selected });
        this.updateDataContextState({ selectedMap: selected }, ['loadMap']);
        console.log(`Map selected:`, selected);
      }
    } else if (selectedMap) {
      this.setState({ selectedMap }, () => {
        this.updateDataContextState({ selectedMap }, ['loadMap']);
        console.log(`Map selected:`, this.state.selectedMap);
      });
    } else if (!selectedMap) {
      this.setState({ selectedMap }, () => {
        this.updateDataContextState({ selectedMap: null }, ['loadMap']);
        console.log(`Map deselected`);
      });
    }
  };

  // transforms mapConfig => mapData => d3 format & decorates
  handleMapData = () => {
    return new Promise(async resolve => {
      // avoid nested references in mapConfig using parse & stringify
      const { mapConfig } = this.state;
      const mapData = JSON.parse(JSON.stringify(mapConfig));

      const nodePromises = Object.keys(mapData.nodeData).map(nodeId => {
        return new Promise(async resolve => {
          // // decorate nrql hover metrics
          const nrqlHoverData = await this.fetchNrql(
            mapData.nodeData[nodeId],
            'hover'
          );
          if (nrqlHoverData) mapData.nodeData[nodeId].hoverData = nrqlHoverData;

          // // decorate nrql hover metrics
          const nrqlAlertData = await this.fetchNrql(
            mapData.nodeData[nodeId],
            'customAlert'
          );
          if (nrqlAlertData)
            mapData.nodeData[nodeId].customAlertData = nrqlAlertData;
          resolve();
        });
      });
      await Promise.all(nodePromises);

      const linkPromises = Object.keys(mapData.linkData).map(linkId => {
        return new Promise(async resolve => {
          // // decorate nrql hover metrics
          const nrqlHoverData = await this.fetchNrql(
            mapData.linkData[linkId],
            'hover'
          );
          if (nrqlHoverData) mapData.linkData[linkId].hoverData = nrqlHoverData;

          // // decorate nrql hover metrics
          const nrqlAlertData = await this.fetchNrql(
            mapData.linkData[linkId],
            'customAlert'
          );
          if (nrqlAlertData)
            mapData.linkData[linkId].customAlertData = nrqlAlertData;
          resolve();
        });
      });
      await Promise.all(linkPromises);

      // fetchEntityData
      const allEntityData = await this.fetchEntityData(mapData);

      const entityPromises = allEntityData.map(entity => {
        return new Promise(async resolve => {
          for (let z = 0; z < Object.keys(mapData.nodeData).length; z++) {
            const key = Object.keys(mapData.nodeData)[z];
            // decorate entity data
            if (entity.guid && entity.guid === mapData.nodeData[key].guid) {
              mapData.nodeData[key] = Object.assign(
                mapData.nodeData[key],
                entity
              );

              // decorate external entity data that is tied from APM Service <> External across the link
              if (
                mapData.nodeData[key].relationships &&
                mapData.nodeData[key].relationships.length > 0
              ) {
                mapData.nodeData[key].relationships.forEach(conn => {
                  const sourceEntityType =
                    (((conn || {}).source || {}).entity || {}).entityType || '';
                  const targetEntityType =
                    (((conn || {}).target || {}).entity || {}).entityType || '';

                  if (sourceEntityType === 'APM_EXTERNAL_SERVICE_ENTITY') {
                    if (mapData.nodeData[conn.source.entity.name]) {
                      const link = `${conn.source.entity.name}:::${key}`;
                      if (mapData.linkData[link]) {
                        mapData.linkData[link].externalSummary = {
                          ...conn.source.entity.externalSummary
                        };
                      }
                    }
                  }

                  if (targetEntityType === 'APM_EXTERNAL_SERVICE_ENTITY') {
                    if (mapData.nodeData[conn.target.entity.name]) {
                      const link = `${key}:::${conn.target.entity.name}`;
                      if (mapData.linkData[link]) {
                        mapData.linkData[link].externalSummary = {
                          ...conn.target.entity.externalSummary
                        };
                      }
                    }
                  }
                });
              }
              break;
            }
          }
          resolve();
        });
      });

      await Promise.all(entityPromises);

      let links = [];
      // reconstruct node data for graph
      let nodes = Object.keys((mapData || {}).nodeData || {}).map(node => {
        const obj = { id: node, ...mapData.nodeData[node] };

        // randomize node location if no x / y coordinates have been set
        if (!obj.x) obj.x = Math.floor(Math.random() * 500) + 50;
        if (!obj.y) obj.y = Math.floor(Math.random() * 500) + 50;
        mapData.nodeData[node].x = obj.x;
        mapData.nodeData[node].y = obj.y;

        // self link so it appears in center
        // needed when not using static graphs
        // links.push({source: node, target: node})
        return obj;
      });

      // add dummy node if none exists
      const element = document.getElementById('nodesbtn');
      const dummyX = element ? element.getBoundingClientRect().x + 40 : 400;

      if (nodes.length === 0)
        nodes = [{ id: 'Add a node!', y: 30, x: dummyX, icon: 'arrow up' }];

      // reconstruct link data for graph
      const mapLinks = Object.keys((mapData || {}).linkData || {}).map(link => {
        return {
          source: mapData.linkData[link].source,
          target: mapData.linkData[link].target
        };
      });

      links = [...links, ...mapLinks];
      const data = { nodes, links };

      console.log('decorated mapData', mapData);

      this.setState({ data, mapData }, resolve());
    });
  };

  // nodeData should be renamed to something generic
  fetchNrql = async (nodeData, fetch) => {
    return new Promise(async resolve => {
      let nrqlQueries = [];

      if (fetch === 'hover' && nodeData.hoverType === 'customNrql') {
        if (nodeData.hoverMetrics) {
          nrqlQueries = Object.keys(nodeData.hoverMetrics)
            .map(i => {
              if (
                nodeData.hoverMetrics[i].nrql &&
                nodeData.hoverMetrics[i].accountId
              ) {
                return nodeData.hoverMetrics[i];
              } else {
                return '';
              }
            })
            .filter(nrql => nrql);
        }
      } else if (
        fetch === 'customAlert' &&
        nodeData.customAlert &&
        nodeData.customAlert.alertNrql &&
        nodeData.customAlert.alertNrqlAcc
      ) {
        nrqlQueries.push({
          nrql: nodeData.customAlert.alertNrql,
          accountId: nodeData.customAlert.alertNrqlAcc
        });
      }

      if (nrqlQueries.length > 0) {
        let query = `{ actor {`;
        const keys = [];

        nrqlQueries.forEach((q, i) => {
          query += singleNrql(`nrql${i}`, q.nrql, q.accountId);
          keys.push(`nrql${i}`);
        });
        query += `}}`;

        const ngResults = await nerdGraphQuery(query);
        const finalResults = [];

        if (ngResults.actor) {
          keys.forEach(key => {
            const results =
              ((ngResults.actor[key] || {}).nrql || {}).results || [];
            if (results.length === 1) {
              Object.keys(results[0]).forEach(item => {
                finalResults.push({
                  name: item,
                  value: results[0][item]
                });
              });
            }
          });
        }

        resolve(finalResults);
      } else {
        resolve();
      }
    });
  };

  fetchEntityData = async mapData => {
    return new Promise(async resolve => {
      const apmEntityGuids = [];
      const otherEntityGuids = [];
      Object.keys((mapData || {}).nodeData || {}).forEach(node => {
        if (mapData.nodeData[node].entityType === 'APM_APPLICATION_ENTITY') {
          apmEntityGuids.push(mapData.nodeData[node].guid);
        } else if (mapData.nodeData[node].guid)
          otherEntityGuids.push(mapData.nodeData[node].guid);
      });

      const entityChunks = chunk(otherEntityGuids, 25);
      const entityPromises = entityChunks.map(chunk => {
        return new Promise(async resolve => {
          const guids = `"${chunk.join(`","`)}"`;
          const nerdGraphResult = await nerdGraphQuery(entityBatchQuery(guids));
          resolve(nerdGraphResult);
        });
      });

      const apmEntityChunks = chunk(apmEntityGuids, 25);
      const apmEntityPromises = apmEntityChunks.map(chunk => {
        return new Promise(async resolve => {
          const guids = `"${chunk.join(`","`)}"`;
          const nerdGraphResult = await nerdGraphQuery(
            ApmEntityBatchQuery(guids)
          );
          resolve(nerdGraphResult);
        });
      });

      await Promise.all([...entityPromises, ...apmEntityPromises]).then(
        values => {
          let entityData = [];
          values.forEach(async value => {
            const entitiesResult = ((value || {}).actor || {}).entities || [];
            entityData = [...entityData, ...entitiesResult];
          });
          resolve(entityData);
        }
      );
    });
  };

  render() {
    const { children } = this.props;

    return (
      <DataContext.Provider
        value={{
          ...this.state,
          updateDataContextState: this.updateDataContextState,
          dataFetcher: this.dataFetcher,
          selectMap: this.selectMap
        }}
      >
        <ToastContainer
          enableMultiContainer
          containerId="B"
          position={toast.POSITION.TOP_RIGHT}
        />

        <ToastContainer
          enableMultiContainer
          containerId="C"
          position={toast.POSITION.BOTTOM_RIGHT}
        />

        {children}
      </DataContext.Provider>
    );
  }
}

export const DataConsumer = DataContext.Consumer;
