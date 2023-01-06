import {ApolloLink, fromPromise, toPromise} from "@apollo/client";
import {buildQuery, getExternalRequests, merge} from "./utils";
import {removeDirectivesFromDocument} from "@apollo/client/utilities";

export class MergeLink extends ApolloLink {
  constructor(options) {
    super();
    Object.assign(this, options);
  }

  async request(operation, forward) {
    const requests = getExternalRequests(operation.query);
    operation.query = removeDirectivesFromDocument(
      [ { name: "pk", remove: true }, { name: 'external', remove: true } ],
      operation.query
    );

    operation.query = removeDirectivesFromDocument([{ name: "fk", remove: false }], operation.query);
    const response = await toPromise(this.default.request(operation));
    const responses = await Promise.all(requests.map((request) => buildQuery.bind(this)(request, response.data)))

    return fromPromise(new Promise(resolve => {
      resolve(merge(response, responses));
    }))
  }
}
