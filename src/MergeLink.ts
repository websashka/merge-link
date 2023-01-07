import {ApolloLink, fromPromise, HttpLink, NextLink, toPromise} from "@apollo/client";
import {buildQuery, getExternalRequests, merge} from "./utils";
import {Observable, removeDirectivesFromDocument} from "@apollo/client/utilities";
import {FetchResult, Operation} from "@apollo/client/link/core/types";

export class MergeLink extends ApolloLink {
  links: {
    [key: string]: HttpLink
  }
  constructor(links: {
    [key: string]: HttpLink
  }) {
    super();
    this.links = links;
  }

  request(operation: Operation, forward: NextLink): Observable<FetchResult> | null {
    return fromPromise(new Promise(async (resolve, reject) => {
      const requests = getExternalRequests(operation.query);
      operation.query = removeDirectivesFromDocument(
        [ { name: "pk", remove: true }, { name: 'external', remove: true } ],
        operation.query
      )!;

      operation.query = removeDirectivesFromDocument([{ name: "fk", remove: false }], operation.query)!;
      const response = await toPromise(this.links.default.request(operation)!);
      const responses = await Promise.all(requests.map((request) => buildQuery.bind(this)(request, response.data)))

      resolve(merge(response, responses));
    }));
  }
}
