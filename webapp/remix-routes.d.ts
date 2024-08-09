declare module "remix-routes" {
  type URLSearchParamsInit = string | string[][] | Record<string, string> | URLSearchParams;
  // symbol won't be a key of SearchParams
  type IsSearchParams<T> = symbol extends keyof T ? false : true;
  
  type ExportedQuery<T> = IsSearchParams<T> extends true ? T : URLSearchParamsInit;
  

  export interface Routes {
  
    "": {
      params: never,
      query: ExportedQuery<import('app/routes/index').SearchParams>,
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
  
    "/app": {
      params: never,
      query: ExportedQuery<import('app/routes/app/_index/_route').SearchParams>,
    };
  
    "/app/denied": {
      params: never,
      query: ExportedQuery<import('app/routes/app/denied/_route').SearchParams>,
    };
  
    "/app/down": {
      params: never,
      query: ExportedQuery<import('app/routes/app/down/_route').SearchParams>,
    };
  
    "/app/emergency": {
      params: never,
      query: ExportedQuery<import('app/routes/app/emergency/_index/_route').SearchParams>,
    };
  
    "/app/emergency/:id": {
      params: {
        id: string | number;
      } ,
      query: ExportedQuery<import('app/routes/app/emergency/$id/_route').SearchParams>,
    };
  
    "/app/proposals": {
      params: never,
      query: ExportedQuery<import('app/routes/app/proposals/_layout').SearchParams>,
    };
  
    "/app/proposals/:id": {
      params: {
        id: string | number;
      } ,
      query: ExportedQuery<import('app/routes/app/proposals/$id/_route').SearchParams>,
    };
  
    "/app/transactions/:hash": {
      params: {
        hash: string | number;
      } ,
      query: ExportedQuery<import('app/routes/app/transactions.$hash/_route').SearchParams>,
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
    | 'routes/$'
    | 'routes/app/_index/_route'
    | 'routes/app/_layout'
    | 'routes/app/denied/_route'
    | 'routes/app/down/_route'
    | 'routes/app/emergency/_index/_route'
    | 'routes/app/emergency/$id/_route'
    | 'routes/app/proposals/_layout'
    | 'routes/app/proposals/$id/_route'
    | 'routes/app/transactions.$hash/_route'
    | 'routes/index';

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