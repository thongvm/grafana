import { PanelModel } from 'app/features/dashboard/state/PanelModel';
import {
  DataLink,
  DisplayValue,
  Field,
  FieldDisplay,
  formattedValueToString,
  getFieldDisplayValuesProxy,
  getTimeField,
  Labels,
  LinkModel,
  LinkModelSupplier,
  ScopedVar,
  ScopedVars,
} from '@grafana/data';
import { getLinkSrv } from './link_srv';
import { config } from 'app/core/config';
import { getTemplateSrv } from '@grafana/runtime';

interface SeriesVars {
  name?: string;
  refId?: string;
}

interface FieldVars {
  name: string;
  labels?: Labels;
}

interface ValueVars {
  raw: any;
  numeric: number;
  text: string;
  time?: number;
  calc?: string;
}

interface DataViewVars {
  name?: string;
  refId?: string;
  fields?: Record<string, DisplayValue>;
}

interface DataLinkScopedVars extends ScopedVars {
  __series?: ScopedVar<SeriesVars>;
  __field?: ScopedVar<FieldVars>;
  __value?: ScopedVar<ValueVars>;
  __data?: ScopedVar<DataViewVars>;
}

/**
 * Link suppliers creates link models based on a link origin
 */
export const getFieldLinksSupplier = (value: FieldDisplay): LinkModelSupplier<FieldDisplay> | undefined => {
  const links = value.field.links;
  if (!links || links.length === 0) {
    return undefined;
  }
  return {
    getLinks: (_scopedVars?: any) => {
      const scopedVars: DataLinkScopedVars = {};

      if (value.view) {
        const { dataFrame } = value.view;

        scopedVars['__series'] = {
          value: {
            name: dataFrame.name,
            refId: dataFrame.refId,
          },
          text: 'Series',
        };

        const field = value.colIndex !== undefined ? dataFrame.fields[value.colIndex] : undefined;
        if (field) {
          console.log('Full Field Info:', field);
          scopedVars['__field'] = {
            value: {
              name: field.name,
              labels: field.labels,
            },
            text: 'Field',
          };
        }

        if (!isNaN(value.rowIndex)) {
          const { timeField } = getTimeField(dataFrame);
          scopedVars['__value'] = {
            value: {
              raw: field.values.get(value.rowIndex),
              numeric: value.display.numeric,
              text: formattedValueToString(value.display),
              time: timeField ? timeField.values.get(value.rowIndex) : undefined,
            },
            text: 'Value',
          };

          // Expose other values on the row
          if (value.view) {
            scopedVars['__data'] = {
              value: {
                name: dataFrame.name,
                refId: dataFrame.refId,
                fields: getFieldDisplayValuesProxy(dataFrame, value.rowIndex!, {
                  theme: config.theme,
                }),
              },
              text: 'Data',
            };
          }
        } else {
          // calculation
          scopedVars['__value'] = {
            value: {
              raw: value.display.numeric,
              numeric: value.display.numeric,
              text: formattedValueToString(value.display),
              calc: value.name,
            },
            text: 'Value',
          };
        }
      } else {
        console.log('VALUE', value);
      }

      return links.map((link: DataLink) => {
        return getLinkSrv().getDataLinkUIModel(link, scopedVars, value);
      });
    },
  };
};

export const getPanelLinksSupplier = (value: PanelModel): LinkModelSupplier<PanelModel> => {
  const links = value.links;

  if (!links || links.length === 0) {
    return undefined;
  }

  return {
    getLinks: () => {
      return links.map(link => {
        return getLinkSrv().getDataLinkUIModel(link, value.scopedVars, value);
      });
    },
  };
};

export const getLinksFromLogsField = (
  field: Field,
  rowIndex: number
): Array<{ linkModel: LinkModel<Field>; link: DataLink }> => {
  const scopedVars: any = {};
  scopedVars['__value'] = {
    value: {
      raw: field.values.get(rowIndex),
    },
    text: 'Raw value',
  };

  return field.config.links
    ? field.config.links.map(link => {
        console.log({ link });
        if (!link.internal) {
          return {
            link,
            linkModel: getLinkSrv().getDataLinkUIModel(link, scopedVars, field),
          };
        } else {
          let stringifiedQuery = '';
          try {
            stringifiedQuery = JSON.stringify(link.internal.query);
          } catch (err) {
            // should not happen and not much to do about this, possibly something non stringifiable in the query
            console.error(err);
          }

          // Replace any variables inside the query. This may not be the safest as it can also replace keys etc so may not
          // actually work with every datasource query right now.
          console.log({ stringifiedQuery });
          stringifiedQuery = getTemplateSrv().replace(stringifiedQuery, scopedVars);
          console.log({ stringifiedQuery });

          let replacedQuery = {};
          try {
            replacedQuery = JSON.parse(stringifiedQuery);
          } catch (err) {
            // again should not happen and not much to do about this, probably some issue with how we replaced the variables.
            console.error(stringifiedQuery, err);
          }

          return {
            link: {
              ...link,
              internal: {
                ...link.internal,
                query: replacedQuery,
              },
            },
            linkModel: {
              title: getTemplateSrv().replace(link.title || '', scopedVars),
              target: '_self',
              origin: field,
            } as LinkModel<Field>,
          };
        }
      })
    : [];
};
