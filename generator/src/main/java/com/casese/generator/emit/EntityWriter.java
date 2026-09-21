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

    if (plan.declaresId()) {
      type.addField(identifierField(plan.id()));
      accessors.addAll(accessorsFor(plan.id().name(), plan.id().type(), signatures));
    }

    for (UmlAttribute attribute : plan.columns()) {
      type.addField(columnField(attribute));
      accessors.addAll(
          accessorsFor(attribute.name(), JavaTypes.of(attribute.dataType()), signatures));
    }

    for (Link link : plan.links()) {
      type.addField(linkField(link));
      accessors.addAll(accessorsFor(link.field(), fieldType(link), signatures));
    }

    accessors.forEach(type::addMethod);
    operations(plan, signatures).forEach(type::addMethod);

    return type.build();
  }

  // --------------------------------------------------------------- los campos

  private FieldSpec identifierField(EntityPlan.Id id) {
    FieldSpec.Builder field =
        FieldSpec.builder(id.type(), id.name(), Modifier.PRIVATE).addAnnotation(Jpa.ID);

    if (id.generated()) {
      String strategy = id.type().toString().endsWith("UUID") ? "UUID" : "IDENTITY";
      field.addAnnotation(
          AnnotationSpec.builder(Jpa.GENERATED_VALUE)
              .addMember("strategy", "$T.$L", Jpa.GENERATION_TYPE, strategy)
              .build());
    }
    field.addAnnotation(
        AnnotationSpec.builder(Jpa.COLUMN)
            .addMember("name", "$S", Names.sqlIdentifier(id.name()))
            .build());

    if (id.synthetic()) {
      field.addJavadoc("El diagrama no marcaba clave primaria; se genera una.\n");
    }
    return field.build();
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

    Defaults.initializer(attribute).ifPresent(field::initializer);

    return field.build();
  }

  private FieldSpec linkField(Link link) {
    FieldSpec.Builder field =
        FieldSpec.builder(fieldType(link), link.field(), Modifier.PRIVATE)
            .addJavadoc("$L\n", describe(link));

    switch (link.kind()) {
      case MANY_TO_ONE -> {
        field.addAnnotation(Jpa.MANY_TO_ONE);
        field.addAnnotation(
            AnnotationSpec.builder(Jpa.JOIN_COLUMN)
                .addMember("name", "$S", link.joinColumn())
                .build());
      }
      case ONE_TO_MANY ->
          field.addAnnotation(collection(Jpa.ONE_TO_MANY, link)).addAnnotation(Jpa.JSON_IGNORE);
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
          field
              .addAnnotation(
                  AnnotationSpec.builder(Jpa.ONE_TO_ONE)
                      .addMember("mappedBy", "$S", link.mappedBy())
                      .build())
              .addAnnotation(Jpa.JSON_IGNORE);
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
          field
              .addAnnotation(
                  AnnotationSpec.builder(Jpa.MANY_TO_MANY)
                      .addMember("mappedBy", "$S", link.mappedBy())
                      .build())
              .addAnnotation(Jpa.JSON_IGNORE);
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
    MethodSpec getter =
        MethodSpec.methodBuilder(Names.accessor("get", field))
            .addModifiers(Modifier.PUBLIC)
            .returns(type)
            .addStatement("return this.$L", field)
            .build();

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
