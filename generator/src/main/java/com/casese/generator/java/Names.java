package com.casese.generator.java;

import java.util.Locale;
import java.util.Set;

/**
 * Nombres: del identificador que escribió el usuario en el lienzo a los que
 * necesita el proyecto generado.
 *
 * <p>Los nombres que llegan ya son identificadores Java válidos y no son
 * palabras reservadas del lenguaje: eso lo comprueba el catálogo UML del
 * backend antes de dejar guardarlos. Lo que aquí queda por resolver es lo que
 * el lenguaje no vigila: que la tabla no se llame como una palabra reservada de
 * SQL, y que las rutas REST se lean en plural.
 */
public final class Names {

  private Names() {}

  /**
   * Palabras que PostgreSQL no acepta como nombre sin comillas. No está la
   * lista entera del estándar, sólo las que de verdad aparecen en un diagrama
   * de clases: una clase «Usuario» es corriente, y «Order» o «Group» también.
   */
  private static final Set<String> RESERVED_SQL =
      Set.of(
          "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "authorization",
          "between", "binary", "both", "case", "cast", "check", "collate", "column", "constraint",
          "create", "cross", "current_date", "current_role", "current_time", "current_timestamp",
          "current_user", "default", "deferrable", "desc", "distinct", "do", "else", "end",
          "except", "false", "for", "foreign", "freeze", "from", "full", "grant", "group",
          "having", "ilike", "in", "initially", "inner", "intersect", "into", "is", "isnull",
          "join", "leading", "left", "like", "limit", "localtime", "localtimestamp", "natural",
          "new", "not", "notnull", "null", "offset", "old", "on", "only", "or", "order", "outer",
          "overlaps", "placing", "primary", "references", "returning", "right", "select",
          "session_user", "similar", "some", "symmetric", "table", "then", "to", "trailing",
          "true", "union", "unique", "user", "using", "verbose", "when", "where", "window",
          "with");

  /** Nombre de clase Java: «cliente» y «Cliente» dan los dos «Cliente». */
  public static String pascal(String name) {
    if (name == null || name.isEmpty()) {
      return name;
    }
    return Character.toUpperCase(name.charAt(0)) + name.substring(1);
  }

  /** Nombre de campo o variable: «Cliente» da «cliente». */
  public static String camel(String name) {
    if (name == null || name.isEmpty()) {
      return name;
    }
    return Character.toLowerCase(name.charAt(0)) + name.substring(1);
  }

  /** Nombre de columna o de tabla: «nombreCliente» da «nombre_cliente». */
  public static String snake(String name) {
    StringBuilder out = new StringBuilder(name.length() + 4);

    for (int i = 0; i < name.length(); i++) {
      char current = name.charAt(i);

      if (Character.isUpperCase(current) && i > 0) {
        char previous = name.charAt(i - 1);
        boolean afterLower = Character.isLowerCase(previous) || Character.isDigit(previous);
        // «ClienteVIP» parte en «cliente_vip» y no en «cliente_v_i_p».
        boolean startsWord =
            i + 1 < name.length() && Character.isLowerCase(name.charAt(i + 1));

        if (afterLower || (Character.isUpperCase(previous) && startsWord)) {
          out.append('_');
        }
      }
      out.append(Character.toLowerCase(current));
    }
    return out.toString();
  }

  /**
   * El nombre para la base de datos, entrecomillado si choca con una palabra
   * reservada. Las comillas invertidas son la forma de Hibernate de decir «éste
   * es un identificador, cítalo como pida el dialecto».
   */
  public static String sqlIdentifier(String name) {
    String snake = snake(name);

    return RESERVED_SQL.contains(snake) ? "`" + snake + "`" : snake;
  }

  /**
   * Pluraliza una palabra ya escrita en la forma que toque: «cliente» da
   * «clientes», «profesor» da «profesores» y «luz» da «luces». No pretende
   * resolver todo el castellano; resuelve lo que aparece en un diagrama y deja
   * una URL y un nombre de colección legibles.
   */
  public static String pluralize(String word) {
    if (word == null || word.isEmpty()) {
      return word;
    }
    char last = Character.toLowerCase(word.charAt(word.length() - 1));

    if (last == 'z') {
      return word.substring(0, word.length() - 1) + "ces";
    }
    if (last == 's' || last == 'x') {
      return word;
    }
    if ("aeiou".indexOf(last) >= 0) {
      return word + "s";
    }
    return word + "es";
  }

  /** Ruta REST del controlador de una clase: «Cliente» da «/api/clientes». */
  public static String restPath(String className) {
    return "/api/" + pluralize(snake(className).toLowerCase(Locale.ROOT)).replace('_', '-');
  }

  /**
   * Nombre del campo que guarda una colección: «DetalleFactura» da
   * «detalleFacturas». Se pluraliza sobre el camelCase y no sobre el
   * snake_case, porque es un identificador Java y no una columna.
   */
  public static String collectionField(String className) {
    return pluralize(camel(className));
  }

  /** «nombre» da «getNombre»; para el prefijo que corresponda. */
  public static String accessor(String prefix, String field) {
    return prefix + pascal(field);
  }
}
