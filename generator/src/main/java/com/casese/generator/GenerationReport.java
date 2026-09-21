package com.casese.generator;

import java.util.List;

/**
 * Lo que el generador cuenta de su trabajo. Se escribe en un archivo JSON, y no
 * por la salida estándar, para que los registros de Spring no se mezclen con
 * él: el backend NestJS lo lee tal cual para saber qué se generó y qué avisos
 * hay que enseñar al usuario.
 */
public record GenerationReport(
    String projectName,
    String basePackage,
    int classes,
    int entities,
    int endpoints,
    List<String> files,
    /** Decisiones que el generador tomó por su cuenta y conviene revisar. */
    List<String> notes) {}
