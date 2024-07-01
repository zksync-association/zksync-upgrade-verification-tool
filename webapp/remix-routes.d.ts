declare module "remix-routes" {
  type URLSearchParamsInit = string | string[][] | Record<string, string> | URLSearchParams;
  // symbol won't be a key of SearchParams
  type IsSearchParams<T> = symbol extends keyof T ? false : true;
  
  type ExportedQuery<T> = IsSearchParams<T> extends true ? T : URLSearchParamsInit;
  

  export interface Routes {
  
    "": {
      params: never,
      query: ExportedQuery<import('app/routes/_index').SearchParams>,
    };
  
    "/": {
      params: never,
      query: ExportedQuery<import('app/root').SearchParams>,
    };
  
    "/*": {
      params: {
        "*": string | number;
      } ,
      query: ExportedQuery<import('app/routes/$').SearchParams>,
    };
  
    "/check-report-test": {
      params: never,
      query: ExportedQuery<import('app/routes/check-report-test/_index').SearchParams>,
    };
  
    "/storage-report-test": {
      params: never,
      query: ExportedQuery<import('app/routes/storage-report-test/_index').SearchParams>,
    };
  
  }

  type RoutesWithParams = Pick<
    Routes,
    {
      [K in keyof Routes]: Routes[K]["params"] extends Record<string, never> ? never : K
    }[keyof Routes]
  >;

  export type RouteId =
    | 'root'
    | 'routes/_index'
    | 'routes/$'
    | 'routes/check-report-test/_index'
    | 'routes/storage-report-test/_index';

  export function $path<
    Route extends keyof Routes,
    Rest extends {
      params: Routes[Route]["params"];
      query?: Routes[Route]["query"];
    }
  >(
    ...args: Rest["params"] extends Record<string, never>
      ? [route: Route, query?: Rest["query"]]
      : [route: Route, params: Rest["params"], query?: Rest["query"]]
  ): string;

  export function $params<
    Route extends keyof RoutesWithParams,
    Params extends RoutesWithParams[Route]["params"]
  >(
      route: Route,
      params: { readonly [key: string]: string | undefined }
  ): {[K in keyof Params]: string};

  export function $routeId(routeId: RouteId): RouteId;
}