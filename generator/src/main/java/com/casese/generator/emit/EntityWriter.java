package com.casese.generator.emit;

import com.casese.generator.java.JavaTypes;
import com.casese.generator.java.Names;
import com.casese.generator.model.UmlAttribute;
import com.casese.generator.model.UmlMethod;
import com.casese.generator.model.UmlParameter;
import com.casese.generator.plan.Blueprint;
import com.casese.generator.plan.EntityPlan;
import com.casese.generator.plan.Link;
import com.squareup.javapoet.AnnotationSpec;
import com.squareup.javapoet.ClassName;
import com.squareup.javapoet.FieldSpec;
import com.squareup.javapoet.MethodSpec;
import com.squareup.javapoet.ParameterizedTypeName;
import com.squareup.javapoet.TypeName;
import com.squareup.javapoet.TypeSpec;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import javax.lang.model.element.Modifier;

/** Escribe la clase {@code @Entity} de una clase del diagrama. */
final class EntityWriter {

  private final Blueprint blueprint;

  EntityWriter(Blueprint blueprint) {
    this.blueprint = blueprint;
  }

  TypeSpec write(EntityPlan plan) {
    TypeSpec.Builder type =
        TypeSpec.classBuilder(Names.pascal(plan.name()))
            .addJavadoc(
                "Generado por CASE-Tool (CU07) a partir de la clase UML «$L».\n", plan.name())
            .addModifiers(Modifier.PUBLIC)
            .addAnnotation(Jpa.ENTITY)
            .addAnnotation(
                AnnotationSpec.builder(Jpa.TABLE)
                    .addMember("name", "$S", Names.sqlIdentifier(plan.name()))
                    .build());

    if (plan.isAbstract()) {
      type.addModifiers(Modifier.ABSTRACT);
    }

    // JOINED da una tabla por clase y la clave foránea entre ellas, que es lo
    // que el usuario dibujó: una jerarquía sigue siendo varias tablas.
    if (plan.hasChildren()) {
      type.addAnnotation(
          AnnotationSpec.builder(Jpa.INHERITANCE)
              .addMember("strategy", "$T.JOINED", Jpa.INHERITANCE_TYPE)
              .build());
    }
    if (plan.parent() != null) {
      type.superclass(blueprint.entityType(plan.parent()));
    }
    for (var realized : plan.interfaces()) {
      type.addSuperinterface(
          ClassName.get(blueprint.entityPackage(), Names.pascal(realized.name())));
    }

    List<MethodSpec> accessors = new ArrayList<>();
    Set<String> signatures = new HashSet<>();

    // El @Id y el @Version van los dos en la raíz de la jerarquía y en ninguna
    // otra: una subclase los hereda, y declararlos de nuevo no compilaría.
    if (plan.declaresId()) {
      type.addField(identifierField());
      accessors.addAll(accessorsFor(EntityPlan.ID_NAME, EntityPlan.ID_TYPE, signatures));

      type.addField(versionField());
      accessors.addAll(accessorsFor(EntityPlan.VERSION_NAME, EntityPlan.VERSION_TYPE, signatures));
    }

    for (UmlAttribute attribute : plan.columns()) {
      type.addField(columnField(attribute));
      accessors.addAll(
          accessorsFor(attribute.name(), JavaTypes.of(attribute.dataType()), signatures));
    }

    for (Link link : plan.links()) {
      type.addField(linkField(link));
      accessors.addAll(
          accessorsFor(link.field(), fieldType(link), signatures, hidesFromJson(link)));
    }

    accessors.forEach(type::addMethod);
    operations(plan, signatures).forEach(type::addMethod);

    return type.build();
  }

  // --------------------------------------------------------------- los campos

  /**
   * La clave primaria: la misma en todas las entidades. {@code IDENTITY} sobre
   * un {@code Long} es la columna {@code BIGSERIAL} que crea PostgreSQL.
   */
  private FieldSpec identifierField() {
    return FieldSpec.builder(EntityPlan.ID_TYPE, EntityPlan.ID_NAME, Modifier.PRIVATE)
        .addJavadoc("Clave primaria de la tabla; la pone la herramienta.\n")
        .addAnnotation(Jpa.ID)
        .addAnnotation(
            AnnotationSpec.builder(Jpa.GENERATED_VALUE)
                .addMember("strategy", "$T.IDENTITY", Jpa.GENERATION_TYPE)
                .build())
        .addAnnotation(
            AnnotationSpec.builder(Jpa.COLUMN)
                .addMember("name", "$S", Names.sqlIdentifier(EntityPlan.ID_NAME))
                .build())
        .build();
  }

  /**
   * El contador de versión que usa JPA para el bloqueo optimista.
   *
   * <p>Lo pone el generador en todas las entidades, como la clave primaria, y
   * es lo que hace que dos escrituras sobre el mismo registro no se pisen: la
   * segunda llega con una versión vieja, Hibernate la rechaza y el proyecto
   * generado responde 409. La aplicación móvil se apoya en eso para detectar
   * los conflictos al sincronizar lo que escribió sin conexión (CU10).
   */
  private FieldSpec versionField() {
    return FieldSpec.builder(EntityPlan.VERSION_TYPE, EntityPlan.VERSION_NAME, Modifier.PRIVATE)
        .addJavadoc(
            "Versión del registro; la lleva JPA y sirve para detectar escrituras en conflicto.\n")
        .addAnnotation(Jpa.VERSION)
        .addAnnotation(
            AnnotationSpec.builder(Jpa.COLUMN)
                .addMember("name", "$S", Names.sqlIdentifier(EntityPlan.VERSION_NAME))
                .build())
        .build();
  }

  private FieldSpec columnField(UmlAttribute attribute) {
    TypeName type = JavaTypes.of(attribute.dataType());

    AnnotationSpec.Builder column =
        AnnotationSpec.builder(Jpa.COLUMN)
            .addMember("name", "$S", Names.sqlIdentifier(attribute.name()));

    if (!attribute.isNullable()) {
      column.addMember("nullable", "$L", false);
    }
    if (attribute.isUnique()) {
      column.addMember("unique", "$L", true);
    }
    String definition = JavaTypes.columnDefinition(attribute.dataType());
    if (definition != null) {
      column.addMember("columnDefinition", "$S", definition);
    }

    FieldSpec.Builder field =
        FieldSpec.builder(type, attribute.name(), Modifier.PRIVATE).addAnnotation(column.build());

    /*
     * Lo que el usuario marcó en el lienzo, comprobado antes de llegar a la
     * base de datos. Sin esto, guardar un obligatorio en blanco daría un error
     * de PostgreSQL —un 500 sin decir cuál de los campos falla—; con esto, el
     * proyecto generado responde 400 señalando el campo, que es lo que el
     * formulario de la aplicación móvil sabe pintar.
     */
    if (!attribute.isNullable()) {
      field.addAnnotation(Jpa.NOT_NULL);
    }
    Integer maxLength = JavaTypes.maxLength(attribute.dataType());
    if (maxLength != null) {
      field.addAnnotation(
          AnnotationSpec.builder(Jpa.SIZE).addMember("max", "$L", maxLength).build());
    }

    Defaults.initializer(attribute).ifPresent(field::initializer);

    return field.build();
  }

  /**
   * Qué relaciones no viajan en el JSON.
   *
   * <p>Las referencias sueltas sí: una Factura llega con su Cliente, que es el
   * dato que lleva encima. Las colecciones no, por dos razones que van juntas.
   * La primera es de sentido: un Cliente no tiene por qué arrastrar todas sus
   * facturas cada vez que se pide un Cliente. La segunda es que JPA las carga
   * perezosamente y la respuesta se escribe fuera de la transacción, de modo
   * que serializarlas no da una lista larga: da un error.
   *
   * <p>El lado inverso de un uno a uno tampoco, aunque no sea colección: quien
   * manda es el que lleva la clave foránea, y devolver los dos lados sería el
   * mismo dato dos veces en un círculo.
   */
  private static boolean hidesFromJson(Link link) {
    return link.isCollection() || !link.isOwner();
  }

  private FieldSpec linkField(Link link) {
    FieldSpec.Builder field =
        FieldSpec.builder(fieldType(link), link.field(), Modifier.PRIVATE)
            .addJavadoc("$L\n", describe(link));

    if (hidesFromJson(link)) {
      field.addAnnotation(Jpa.JSON_IGNORE);
    }

    switch (link.kind()) {
      case MANY_TO_ONE -> {
        field.addAnnotation(Jpa.MANY_TO_ONE);
        field.addAnnotation(
            AnnotationSpec.builder(Jpa.JOIN_COLUMN)
                .addMember("name", "$S", link.joinColumn())
                .build());
      }
      case ONE_TO_MANY -> field.addAnnotation(collection(Jpa.ONE_TO_MANY, link));
      case ONE_TO_ONE_OWNER -> {
        AnnotationSpec.Builder one = AnnotationSpec.builder(Jpa.ONE_TO_ONE);
        if (link.cascade()) {
          one.addMember("cascade", "$T.ALL", Jpa.CASCADE_TYPE)
              .addMember("orphanRemoval", "$L", true);
        }
        field.addAnnotation(one.build());
        field.addAnnotation(
            AnnotationSpec.builder(Jpa.JOIN_COLUMN)
                .addMember("name", "$S", link.joinColumn())
                .addMember("unique", "$L", true)
                .build());
      }
      case ONE_TO_ONE_INVERSE ->
          field.addAnnotation(
              AnnotationSpec.builder(Jpa.ONE_TO_ONE)
                  .addMember("mappedBy", "$S", link.mappedBy())
                  .build());
      case MANY_TO_MANY_OWNER -> {
        field.addAnnotation(Jpa.MANY_TO_MANY);
        field.addAnnotation(
            AnnotationSpec.builder(Jpa.JOIN_TABLE)
                .addMember("name", "$S", link.joinTable())
                .addMember(
                    "joinColumns",
                    "$L",
                    AnnotationSpec.builder(Jpa.JOIN_COLUMN)
                        .addMember("name", "$S", link.joinColumnHere())
                        .build())
                .addMember(
                    "inverseJoinColumns",
                    "$L",
                    AnnotationSpec.builder(Jpa.JOIN_COLUMN)
                        .addMember("name", "$S", link.joinColumnThere())
                        .build())
                .build());
      }
      case MANY_TO_MANY_INVERSE ->
          field.addAnnotation(
              AnnotationSpec.builder(Jpa.MANY_TO_MANY)
                  .addMember("mappedBy", "$S", link.mappedBy())
                  .build());
    }

    if (link.isCollection()) {
      field.initializer("new $T<>()", ArrayList.class);
    }
    return field.build();
  }

  private AnnotationSpec collection(ClassName annotation, Link link) {
    AnnotationSpec.Builder builder =
        AnnotationSpec.builder(annotation).addMember("mappedBy", "$S", link.mappedBy());

    // En una composición las partes no viven sin el todo: se guardan y se
    // borran con él.
    if (link.cascade()) {
      builder
          .addMember("cascade", "$T.ALL", Jpa.CASCADE_TYPE)
          .addMember("orphanRemoval", "$L", true);
    }
    return builder.build();
  }

  private TypeName fieldType(Link link) {
    ClassName other = blueprint.entityType(link.other());

    return link.isCollection()
        ? ParameterizedTypeName.get(ClassName.get(List.class), other)
        : other;
  }

  /** El javadoc del campo dice de qué línea del diagrama salió. */
  private String describe(Link link) {
    return "%s del diagrama: %s %s — %s %s."
        .formatted(
            kindName(link.origin().relationshipType()),
            or(link.origin().sourceMultiplicity()),
            blueprint.nameOf(link.origin().sourceClassId()),
            blueprint.nameOf(link.origin().targetClassId()),
            or(link.origin().targetMultiplicity()));
  }

  private static String or(String multiplicity) {
    return multiplicity == null ? "?" : multiplicity;
  }

  private static String kindName(String relationshipType) {
    return switch (relationshipType) {
      case "AGGREGATION" -> "Agregación";
      case "COMPOSITION" -> "Composición";
      default -> "Asociación";
    };
  }

  // ------------------------------------------------------------- los métodos

  private List<MethodSpec> accessorsFor(String field, TypeName type, Set<String> signatures) {
    return accessorsFor(field, type, signatures, false);
  }

  /**
   * El par de descriptores de acceso de un campo.
   *
   * <p>{@code hiddenFromJson} pone el {@code @JsonIgnore} también en el
   * descriptor, y no sólo en el campo, porque no siempre es lo mismo: Jackson
   * empareja campo y descriptor por el nombre que deduce de cada uno, y con una
   * clase escrita en mayúsculas no coinciden —el campo {@code nOTAVENTAs} da
   * «nOTAVENTAs» y {@code getNOTAVENTAs()} da «notaventas»—. La anotación se
   * quedaba entonces en un campo que Jackson ni miraba, la colección se
   * serializaba igual y cualquier GET acababa en un 500 al intentar cargarla
   * fuera de la transacción.
   */
  private List<MethodSpec> accessorsFor(
      String field, TypeName type, Set<String> signatures, boolean hiddenFromJson) {

    MethodSpec.Builder getterBuilder =
        MethodSpec.methodBuilder(Names.accessor("get", field))
            .addModifiers(Modifier.PUBLIC)
            .returns(type)
            .addStatement("return this.$L", field);

    if (hiddenFromJson) {
      getterBuilder.addAnnotation(Jpa.JSON_IGNORE);
    }
    MethodSpec getter = getterBuilder.build();

    MethodSpec setter =
        MethodSpec.methodBuilder(Names.accessor("set", field))
            .addModifiers(Modifier.PUBLIC)
            .addParameter(type, field)
            .addStatement("this.$L = $L", field, field)
            .build();

    signatures.add(signature(getter.name, List.of()));
    signatures.add(signature(setter.name, List.of(type)));

    return List.of(getter, setter);
  }

  /**
   * Las operaciones que el usuario declaró en la clase. Se escriben con la
   * firma exacta del diagrama y un cuerpo que avisa de que falta escribirlas:
   * así el proyecto compila y arranca, y queda señalado lo único que el
   * generador no puede adivinar.
   *
   * <p>Una operación que choque con un descriptor de acceso ya generado se
   * omite; declararla dos veces impediría compilar.
   */
  private List<MethodSpec> operations(EntityPlan plan, Set<String> signatures) {
    List<MethodSpec> methods = new ArrayList<>();

    for (UmlMethod method : plan.umlClass().methods()) {
      TypeName returns = blueprint.resolve(method.returnType());
      List<TypeName> parameterTypes =
          method.parameters().stream()
              .map(parameter -> blueprint.resolve(parameter.dataType()))
              .collect(Collectors.toList());

      if (!signatures.add(signature(method.name(), parameterTypes))) {
        continue;
      }

      MethodSpec.Builder builder =
          MethodSpec.methodBuilder(method.name())
              .addModifiers(visibility(method.visibility()))
              .returns(returns);

      for (int i = 0; i < method.parameters().size(); i++) {
        UmlParameter parameter = method.parameters().get(i);
        builder.addParameter(parameterTypes.get(i), parameter.name());
      }

      builder.addStatement(
          "throw new $T($S)",
          UnsupportedOperationException.class,
          "Operación «" + method.name() + "» declarada en el diagrama y aún sin implementar.");

      methods.add(builder.build());
    }
    return methods;
  }

  private static Modifier[] visibility(String umlVisibility) {
    return switch (umlVisibility == null ? "public" : umlVisibility) {
      case "private" -> new Modifier[] {Modifier.PRIVATE};
      case "protected" -> new Modifier[] {Modifier.PROTECTED};
      // «package» en UML es el acceso por defecto de Java, que no se escribe.
      case "package" -> new Modifier[] {};
      default -> new Modifier[] {Modifier.PUBLIC};
    };
  }

  private static String signature(String name, List<TypeName> parameters) {
    return name
        + "("
        + parameters.stream().map(TypeName::toString).collect(Collectors.joining(","))
        + ")";
  }
}
