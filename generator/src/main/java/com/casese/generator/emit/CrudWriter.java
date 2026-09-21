package com.casese.generator.emit;

import com.casese.generator.java.Names;
import com.casese.generator.plan.Blueprint;
import com.casese.generator.plan.EntityPlan;
import com.squareup.javapoet.AnnotationSpec;
import com.squareup.javapoet.ClassName;
import com.squareup.javapoet.FieldSpec;
import com.squareup.javapoet.MethodSpec;
import com.squareup.javapoet.ParameterSpec;
import com.squareup.javapoet.ParameterizedTypeName;
import com.squareup.javapoet.TypeName;
import com.squareup.javapoet.TypeSpec;
import java.util.List;
import java.util.Optional;
import javax.lang.model.element.Modifier;

/**
 * Las tres capas de acceso de una entidad: repositorio, servicio y controlador.
 *
 * <p>Están juntas porque son una sola decisión: el CRUD que toda entidad tiene
 * por el hecho de serlo. Lo que el diagrama añade por encima de eso son las
 * operaciones declaradas en la clase, que se escriben en la propia entidad.
 */
final class CrudWriter {

  private final Blueprint blueprint;

  CrudWriter(Blueprint blueprint) {
    this.blueprint = blueprint;
  }

  /** {@code interface ClienteRepository extends JpaRepository<Cliente, Long>}. */
  TypeSpec repository(EntityPlan plan) {
    ClassName entity = blueprint.entityType(plan.umlClass());
    TypeName id = blueprint.identifierFor(plan).type();

    return TypeSpec.interfaceBuilder(blueprint.repositoryType(plan.umlClass()).simpleName())
        .addJavadoc("Acceso a datos de $L. Spring Data implementa esta interfaz.\n", plan.name())
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(Jpa.REPOSITORY_ANNOTATION)
        .addSuperinterface(ParameterizedTypeName.get(Jpa.JPA_REPOSITORY, entity, id.box()))
        .build();
  }

  TypeSpec service(EntityPlan plan) {
    ClassName entity = blueprint.entityType(plan.umlClass());
    ClassName repository = blueprint.repositoryType(plan.umlClass());
    EntityPlan.Id id = blueprint.identifierFor(plan);
    TypeName idType = id.type();

    String variable = Names.camel(entity.simpleName());
    TypeName listOfEntity = ParameterizedTypeName.get(ClassName.get(List.class), entity);
    TypeName optionalOfEntity = ParameterizedTypeName.get(ClassName.get(Optional.class), entity);

    return TypeSpec.classBuilder(blueprint.serviceType(plan.umlClass()).simpleName())
        .addJavadoc("Reglas de negocio de $L.\n", plan.name())
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(Jpa.SERVICE_ANNOTATION)
        .addAnnotation(Jpa.TRANSACTIONAL)
        .addField(
            FieldSpec.builder(repository, "repository", Modifier.PRIVATE, Modifier.FINAL).build())
        .addMethod(
            MethodSpec.constructorBuilder()
                .addModifiers(Modifier.PUBLIC)
                .addParameter(repository, "repository")
                .addStatement("this.repository = repository")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("findAll")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(readOnly())
                .returns(listOfEntity)
                .addStatement("return this.repository.findAll()")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("findById")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(readOnly())
                .returns(optionalOfEntity)
                .addParameter(idType, "id")
                .addStatement("return this.repository.findById(id)")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("create")
                .addModifiers(Modifier.PUBLIC)
                .returns(entity)
                .addParameter(entity, variable)
                .addStatement("return this.repository.save($L)", variable)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("update")
                .addModifiers(Modifier.PUBLIC)
                .returns(optionalOfEntity)
                .addParameter(idType, "id")
                .addParameter(entity, variable)
                .addJavadoc(
                    "Vacío si no existe: es lo que el controlador traduce a 404.\n")
                .addCode(
                    """
                    if (!this.repository.existsById(id)) {
                      return $T.empty();
                    }
                    """,
                    Optional.class)
                // El identificador manda el de la ruta, no el del cuerpo: así
                // un PUT no puede mover el registro a otro id.
                .addStatement("$L.$L(id)", variable, Names.accessor("set", id.name()))
                .addStatement("return $T.of(this.repository.save($L))", Optional.class, variable)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("delete")
                .addModifiers(Modifier.PUBLIC)
                .returns(TypeName.BOOLEAN)
                .addParameter(idType, "id")
                .addCode(
                    """
                    if (!this.repository.existsById(id)) {
                      return false;
                    }
                    """)
                .addStatement("this.repository.deleteById(id)")
                .addStatement("return true")
                .build())
        .build();
  }

  TypeSpec controller(EntityPlan plan) {
    ClassName entity = blueprint.entityType(plan.umlClass());
    ClassName service = blueprint.serviceType(plan.umlClass());
    TypeName idType = blueprint.identifierFor(plan).type();

    String variable = Names.camel(entity.simpleName());
    TypeName listOfEntity = ParameterizedTypeName.get(ClassName.get(List.class), entity);
    TypeName responseOfEntity = ParameterizedTypeName.get(Jpa.RESPONSE_ENTITY, entity);
    TypeName responseOfVoid =
        ParameterizedTypeName.get(Jpa.RESPONSE_ENTITY, ClassName.get(Void.class));

    return TypeSpec.classBuilder(blueprint.controllerType(plan.umlClass()).simpleName())
        .addJavadoc("API REST de $L.\n", plan.name())
        .addModifiers(Modifier.PUBLIC)
        .addAnnotation(Jpa.REST_CONTROLLER)
        .addAnnotation(
            AnnotationSpec.builder(Jpa.REQUEST_MAPPING)
                .addMember("value", "$S", Names.restPath(plan.name()))
                .build())
        .addField(FieldSpec.builder(service, "service", Modifier.PRIVATE, Modifier.FINAL).build())
        .addMethod(
            MethodSpec.constructorBuilder()
                .addModifiers(Modifier.PUBLIC)
                .addParameter(service, "service")
                .addStatement("this.service = service")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("findAll")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(Jpa.GET_MAPPING)
                .returns(listOfEntity)
                .addStatement("return this.service.findAll()")
                .build())
        .addMethod(
            MethodSpec.methodBuilder("findById")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(mapping(Jpa.GET_MAPPING, "/{id}"))
                .returns(responseOfEntity)
                .addParameter(pathVariable(idType))
                .addStatement(
                    "return this.service.findById(id).map($T::ok)"
                        + ".orElseGet(() -> $T.notFound().build())",
                    Jpa.RESPONSE_ENTITY,
                    Jpa.RESPONSE_ENTITY)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("create")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(Jpa.POST_MAPPING)
                .returns(responseOfEntity)
                .addParameter(requestBody(entity, variable))
                .addStatement(
                    "return $T.status($T.CREATED).body(this.service.create($L))",
                    Jpa.RESPONSE_ENTITY,
                    Jpa.HTTP_STATUS,
                    variable)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("update")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(mapping(Jpa.PUT_MAPPING, "/{id}"))
                .returns(responseOfEntity)
                .addParameter(pathVariable(idType))
                .addParameter(requestBody(entity, variable))
                .addStatement(
                    "return this.service.update(id, $L).map($T::ok)"
                        + ".orElseGet(() -> $T.notFound().build())",
                    variable,
                    Jpa.RESPONSE_ENTITY,
                    Jpa.RESPONSE_ENTITY)
                .build())
        .addMethod(
            MethodSpec.methodBuilder("delete")
                .addModifiers(Modifier.PUBLIC)
                .addAnnotation(mapping(Jpa.DELETE_MAPPING, "/{id}"))
                .returns(responseOfVoid)
                .addParameter(pathVariable(idType))
                .addStatement(
                    "return this.service.delete(id) ? $T.noContent().build()"
                        + " : $T.notFound().build()",
                    Jpa.RESPONSE_ENTITY,
                    Jpa.RESPONSE_ENTITY)
                .build())
        .build();
  }

  private static AnnotationSpec readOnly() {
    return AnnotationSpec.builder(Jpa.TRANSACTIONAL).addMember("readOnly", "$L", true).build();
  }

  private static AnnotationSpec mapping(ClassName annotation, String path) {
    return AnnotationSpec.builder(annotation).addMember("value", "$S", path).build();
  }

  private static ParameterSpec pathVariable(TypeName idType) {
    return ParameterSpec.builder(idType, "id").addAnnotation(Jpa.PATH_VARIABLE).build();
  }

  private static ParameterSpec requestBody(TypeName type, String name) {
    return ParameterSpec.builder(type, name).addAnnotation(Jpa.REQUEST_BODY).build();
  }
}
