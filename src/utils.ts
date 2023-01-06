import {ApolloClient, ApolloLink, gql, HttpLink, InMemoryCache, toPromise, fromPromise , parser} from "@apollo/client";
import { removeDirectivesFromDocument } from "@apollo/client/utilities";
import {createOperation} from "@apollo/client/link/utils";
import { visit } from "graphql";
import get from "lodash.get";
import set from "lodash.set";
import unique from "lodash.uniq";
import traverse from "traverse";

export const getDirectiveFromNode = (root, node, path) => {
  const parentNode = get(root, path.slice(0, -2));
  const args = node.arguments.reduce((acc, argument) => {
    acc[argument.name.value] = argument.value.value;
    return acc;
  }, {});

  const doc = get(root, path.slice(0, 5));
  const absolutePath = path.slice(5).reduce((acc, cur, index) => {
    const prev = acc[index - 1]
    let str = prev || "";
    if(prev) {
      str += "."
    }
    str += cur
    acc.push(str)
    return acc;
  }, []);

  const pathToNode = absolutePath.reduce((result, key) => {
    const node = get(doc, key);
    if(node.kind === "Field") {
      result.push(node.name.value)
    }
    return result;
  }, [doc.name.value]);

  return {
    name: node.name.value,
    value: parentNode.name.value,
    args,
    pathToNode,
    selectionSet: parentNode.selectionSet
  }
};

export const getExternalRequests = (doc) => {
  let requests = [];

  const createOrUpdateRequest = (name, valuesOrFunc) => {
    const request = requests.find(request => request.name === name);

    if(typeof valuesOrFunc === "function" && !request) {
      throw new Error("Request not found")
    }

    if(typeof  valuesOrFunc === "function") {
      const changes = valuesOrFunc(request);
      requests = requests.map((request) => {
        if(request.name === name) {
          return {
            ...request,
            ...changes
          }
        }
        return {...request}
      })
      return
    }

    if(!request) {
      const newRequest = {
        name,
        ...valuesOrFunc
      };
      requests = [...requests, newRequest];
    }


    if(request) {
      requests = requests.map((request) => {
        if(request.name === name) {
          return {
            ...request,
            ...valuesOrFunc
          }
        }
        return {...request}
      })
    }

  };

  visit(doc, {
    Directive: {
      enter(node, key, parent, path) {
        const { name, args, value, selectionSet, pathToNode } = getDirectiveFromNode(doc, node, path);
        switch (name) {
          case "external":
            createOrUpdateRequest(value, {
              api: args.api,
              table: args.table,
              selectionSet,
              path: pathToNode,
              args: args.args
            })
            break;
          case "pk":
            createOrUpdateRequest(args.field, (request) => {
              const pathToPrimaryKey = pathToNode.filter(item => !request.path.includes(item));
              return ({ pk: { name: value, path: pathToPrimaryKey } })
            })
            break;
          case "fk":
            createOrUpdateRequest(args.field, { fk: { name: value, path: pathToNode } })
            break;
          default:
        }
      }
    }
  })

  return requests
};

export const getForeignKeys = (response, paths) => {
  let node = response;
  paths.forEach(path => {
    if(Array.isArray(node)) {
      node = node.map(item => item[path]).flat();
    } else {
      node = node[path];
    }
  });
  return unique(node);
}

export function buildQuery({ name, table, api, selectionSet, pk, fk, path, args }, mainResponse) {
  let params = ''
  if(args) {
    params += '('
    const foreignKeys = getForeignKeys(mainResponse, fk.path);
    params += args.replace(/\$fk/, JSON.stringify(foreignKeys));
    params += ')'
  }
  const documentNode = gql`
    query ${name}Query {
    ${table}${params}
    }`;

  return toPromise(this[api].request(createOperation({}, {
    query: removeDirectivesFromDocument([{ name: "pk"}], visit(documentNode, {
      enter(node) {
        if(node.kind === "Field" && node.name.value === table) {
          return {
            ...node,
            selectionSet
          }
        }
      }
    }))
  }))).then((res => ({ path, pk, fk, data: res.data[table]})))
}
export const merge = (mainResponse, responses) => {
  const availablePaths = traverse(mainResponse.data).paths();
  responses.forEach((res) => {
    availablePaths.filter(arr => res.fk.path.every((item => arr.includes(item)))).forEach(path => {
      const fk = get(mainResponse.data, path);
      const entities = traverse(res.data).paths().filter(arr => res.pk.path.every((item => arr.includes(item)))).map((path) => get(res.data, path))
      console.log(entities)
      const entity = entities.find(item => item[res.pk.name] === fk);
      path[path.length - 1] = res.path[res.path.length - 1];
      set(mainResponse.data, path, entity);
    });
  });

  return {
    ...mainResponse
  }
}
