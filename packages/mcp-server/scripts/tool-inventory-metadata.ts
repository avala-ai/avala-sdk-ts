export interface RestMetadata {
  restRoute: string | null;
  restMethod: string | null;
  restUpstream: string | null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** Preserve every declared composite method/route pair for permission audits. */
export function collectRestMetadata(
  meta: Record<string, unknown>,
): RestMetadata {
  const singleRoute = meta["avala.ai/rest-route"];
  const singleMethod = meta["avala.ai/rest-method"];
  if (typeof singleRoute === "string") {
    const method = typeof singleMethod === "string" ? singleMethod : null;
    return {
      restRoute: singleRoute,
      restMethod: method,
      restUpstream: method ? `${method} ${singleRoute}` : singleRoute,
    };
  }

  const routes = stringList(meta["avala.ai/rest-routes"]);
  const methods = stringList(meta["avala.ai/rest-methods"]);
  if (routes.length === 0) {
    return { restRoute: null, restMethod: null, restUpstream: null };
  }

  return {
    restRoute: routes.join(", "),
    restMethod: methods.length > 0 ? methods.join(", ") : null,
    restUpstream: routes
      .map((route, index) => {
        const method = methods[index] ?? "UNKNOWN";
        return `${method} ${route}`;
      })
      .join(", "),
  };
}
