package com.casese.generator.emit;

import com.casese.generator.java.JavaTypes;
import com.casese.generator.java.Names;
import com.casese.generator.model.UmlAttribute;
import com.casese.generator.plan.Blueprint;
import com.casese.generator.plan.EntityPlan;
import com.casese.generator.plan.Link;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.squareup.javapoet.AnnotationSpec;
import com.squareup.javapoet.ClassName;
import com.squareup.javapoet.FieldSpec;
import com.squareup.javapoet.MethodSpec;
import com.squareup.javapoet.ParameterizedTypeName;
import com.squareup.javapoet.TypeName;
import com.squareup.javapoet.TypeSpec;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import javax.lang.model.element.Modifier;

/**
 * {@code GET /api/_meta}: el backend generado contando qué modelo implementa.
 *
 * <p>Es lo que convierte a la aplicación móvil en una sola aplicación que vale
 * para cualquier diagrama. En vez de generar código Flutter por diagrama, el
 * backend publica la descripción de sus entidades —campos, tipos, obligatorios,
 * longitudes y relaciones— y la aplicación construye con ella sus listas y sus
 * formularios.
 *
 * <p>La descripción se calcula aquí, al generar, y viaja incrustada como una
 * constante del propio controlador. No se calcula al arrancar ni se le pregunta
 * a la herramienta: el backend generado se entrega en un .zip y tiene que
 * funcionar solo, sin que nadie más esté encendido.
 */
final class MetaWriter {

  /**
   * El JSON se escribe con Jackson y se incrusta con {@code $S}, que es lo
   * único que escapa bien las comillas. Con {@code $L} JavaPoet lo copiaría tal
   * cual y el archivo no compilaría.
   *
   * <p>Sin sangrar, y no por ahorrar bytes: sangrado, Jackson corta las líneas
   * con el separador de la máquina donde se generó, y el mismo diagrama daría
   * un archivo distinto en Windows y en Linux.
   */
  private static final ObjectMapper MAPPER =
      JsonMapper.builder().disable(SerializationFeature.INDENT_OUTPUT).build();

  private final Blueprint blueprint;

  MetaWriter(Blueprint blueprint) {
    this.blueprint = blueprint;
  }

  TypeSpec write() {
    return TypeSpec.classBuilder("MetaController")
        .addJavadoc(
            """
            Descripción del modelo que implementa este backend, generada por
            CASE-Tool (CU07) a partir del diagrama «$L».

            <p>La consume la aplicación móvil (CU09) para construir sus
            pantallas sin saber nada de este diagrama en concreto.
            """,
            blueprint.model().name())
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(Jpa.REST_CONTROLLER)
        .addField(
            FieldSpec.builder(
                    String.class, "META", Modifier.PRIVATE, Modifier.STATIC, Modifier.FINAL)
                .addJavadoc("Calculado al generar el proyecto; aquí ya no cambia.\n")
                .initializer("$S", describe())
                .build())
        .addMethod(
            MethodSpec.methodBuilder("meta")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(
                    AnnotationSpec.builder(Jpa.GET_MAPPING)
                        .addMember("value", "$S", "/api/_meta")
                        .build())
                .returns(ParameterizedTypeName.get(Jpa.RESPONSE_ENTITY, ClassName.get(String.class)))
                .addStatement(
                    "return $T.ok().contentType($T.APPLICATION_JSON).body(META)",
                    Jpa.RESPONSE_ENTITY,
                    Jpa.MEDIA_TYPE)
                .build())
        .build();
  }

  // ------------------------------------------------------------ la descripción

  private String describe() {
    ObjectNode root = MAPPER.createObjectNode();
    root.put("diagram", blueprint.model().name());
    root.put("generated_at", Instant.now().truncatedTo(ChronoUnit.SECONDS).toString());

    ArrayNode entities = root.putArray("entities");
    for (EntityPlan plan : blueprint.entities()) {
      entities.add(entity(plan));
    }

    try {
      return MAPPER.writeValueAsString(root);
    } catch (JsonProcessingException impossible) {
      // Sólo nodos que acaba de construir este método; no hay nada que no se
      // pueda escribir.
      throw new IllegalStateException("No se pudo escribir la descripción del modelo", impossible);
    }
  }

  private ObjectNode entity(EntityPlan plan) {
    ObjectNode node = MAPPER.createObjectNode();
    node.put("name", plan.name());
    node.put("table", Names.sqlIdentifier(plan.name()));
    node.put("path", Names.restPath(plan.name()));

    // Una clase abstracta tiene tabla pero no controlador: quien lea esto no
    // debe ofrecerla como una lista que se pueda abrir.
    node.put("abstract", plan.isAbstract());
    if (plan.parent() == null) {
      node.putNull("extends");
    } else {
      node.put("extends", plan.parent().name());
    }

    ObjectNode id = node.putObject("id");
    id.put("name", EntityPlan.ID_NAME);
    id.put("type", EntityPlan.ID_TYPE.simpleName());

    // El contador de versión es un campo de sistema como la clave primaria: no
    // se pide en un formulario, pero se devuelve al guardar para que el cliente
    // sepa con qué versión está trabajando.
    ObjectNode version = node.putObject("version");
    version.put("name", EntityPlan.VERSION_NAME);
    version.put("type", EntityPlan.VERSION_TYPE.simpleName());

    ArrayNode fields = node.putArray("fields");
    for (UmlAttribute attribute : plan.columns()) {
      fields.add(field(attribute));
    }

    ArrayNode relations = node.putArray("relations");
    for (Link link : plan.links()) {
      relations.add(relation(link));
    }
    return node;
  }

  private ObjectNode field(UmlAttribute attribute) {
    ObjectNode node = MAPPER.createObjectNode();

    // El nombre tal como viaja en el JSON, que es lo que el cliente necesita
    // mandar; casi siempre es el mismo que escribió el usuario en el lienzo.
    node.put("name", Names.jsonProperty(attribute.name()));

    // El nombre del tipo Java, que es el que se genera: un «Text» del catálogo
    // viejo se cuenta como el String que acabó siendo.
    TypeName type = JavaTypes.of(attribute.dataType());
    node.put(
        "type", type instanceof ClassName className ? className.simpleName() : type.toString());
    node.put("required", !attribute.isNullable());
    node.put("unique", attribute.isUnique());

    Integer maxLength = JavaTypes.maxLength(attribute.dataType());
    if (maxLength == null) {
      node.putNull("maxLength");
    } else {
      node.put("maxLength", maxLength);
    }

    String value = attribute.defaultValue();
    if (value == null || value.isBlank()) {
      node.putNull("default");
    } else {
      node.put("default", value);
    }
    return node;
  }

  private ObjectNode relation(Link link) {
    ObjectNode node = MAPPER.createObjectNode();
    node.put("field", Names.jsonProperty(link.field()));
    node.put("kind", kind(link));
    node.put("target", link.other().name());

    // El propietario es quien lleva la clave foránea, y por tanto el único lado
    // por el que se puede establecer la relación al guardar.
    node.put("owner", link.isOwner());
    if (link.joinColumn() == null) {
      node.putNull("joinColumn");
    } else {
      node.put("joinColumn", link.joinColumn());
    }
    return node;
  }

  /**
   * El nombre de la cardinalidad tal como la espera quien lee {@code _meta}: los
   * dos lados de un muchos a muchos son un muchos a muchos, y cuál de ellos es
   * el propietario ya lo dice {@code owner}.
   */
  private static String kind(Link link) {
    return switch (link.kind()) {
      case MANY_TO_ONE -> "MANY_TO_ONE";
      case ONE_TO_MANY -> "ONE_TO_MANY";
      case ONE_TO_ONE_OWNER, ONE_TO_ONE_INVERSE -> "ONE_TO_ONE";
      case MANY_TO_MANY_OWNER, MANY_TO_MANY_INVERSE -> "MANY_TO_MANY";
    };
  }
}
